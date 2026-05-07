#!/usr/bin/env python3
"""
Export distinct submitter_ip from reviews + country name (ip-api.com batch API, no key).

Usage (from repo root, venv active):
  .venv/bin/python scripts/export_review_ips_countries.py

Override DB URL without touching .env (e.g. production read-only):
  REVIEW_IP_EXPORT_DATABASE_URL='postgresql://...' .venv/bin/python scripts/export_review_ips_countries.py

Writes output/review_ips_by_country.csv and prints a Markdown table to stdout.
"""
from __future__ import annotations

import asyncio
import csv
import ipaddress
import os
import sys
from pathlib import Path

import httpx

# ip-api.com free batch: max 100 IPs/request; stay under global rate limits.
BATCH_SIZE = 100
BATCH_PAUSE_SEC = 5.0


def _is_public_ip(s: str) -> bool:
    try:
        ip = ipaddress.ip_address(s.strip())
    except ValueError:
        return False
    return not (ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_multicast or ip.is_link_local)


async def _geolocate_batch(client: httpx.AsyncClient, ips: list[str]) -> list[dict]:
    url = "http://ip-api.com/batch?fields=status,message,query,country,countryCode"
    r = await client.post(url, json=ips)
    r.raise_for_status()
    return r.json()


def _database_url() -> str:
    """Prefer explicit env for one-off prod export (project .env uses load_dotenv(override=True))."""
    direct = (os.environ.get("REVIEW_IP_EXPORT_DATABASE_URL") or "").strip()
    if direct:
        return direct
    repo_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(repo_root / "src"))
    from hr_breaker.config import get_settings

    return (get_settings().database_url or "").strip()


async def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(repo_root / "src"))

    db_url = _database_url()
    if not db_url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 1

    try:
        import asyncpg
    except ImportError:
        print("Install DB extras: uv pip install 'hr-breaker[db]'", file=sys.stderr)
        return 1

    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(
            """
            SELECT submitter_ip AS ip, COUNT(*)::int AS n
            FROM reviews
            WHERE submitter_ip IS NOT NULL AND btrim(submitter_ip) <> ''
            GROUP BY submitter_ip
            ORDER BY n DESC, submitter_ip
            """
        )
    finally:
        await conn.close()

    if not rows:
        print("No submitter_ip values in table reviews.")
        return 0

    ips_in_order = [str(r["ip"]) for r in rows]
    counts = {str(r["ip"]): int(r["n"]) for r in rows}

    geo_by_ip: dict[str, dict[str, str]] = {}
    async with httpx.AsyncClient(timeout=45.0) as client:
        for i in range(0, len(ips_in_order), BATCH_SIZE):
            chunk = ips_in_order[i : i + BATCH_SIZE]
            try:
                batch = await _geolocate_batch(client, chunk)
            except Exception as e:
                print(f"Geo lookup failed for batch starting at {i}: {e}", file=sys.stderr)
                for ip in chunk:
                    geo_by_ip[ip] = {"country": "", "countryCode": "", "note": "lookup_error"}
                continue

            if len(batch) != len(chunk):
                print(
                    f"Warning: batch size mismatch ({len(batch)} vs {len(chunk)}), aligning by index.",
                    file=sys.stderr,
                )
            for j, ip in enumerate(chunk):
                item = batch[j] if j < len(batch) else {}
                if item.get("status") == "success":
                    geo_by_ip[ip] = {
                        "country": str(item.get("country") or ""),
                        "countryCode": str(item.get("countryCode") or ""),
                        "note": "",
                    }
                else:
                    geo_by_ip[ip] = {
                        "country": "",
                        "countryCode": "",
                        "note": str(item.get("message") or item.get("status") or "unknown"),
                    }

            if i + BATCH_SIZE < len(ips_in_order):
                await asyncio.sleep(BATCH_PAUSE_SEC)

    out_dir = repo_root / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "review_ips_by_country.csv"

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ip", "country", "country_code", "review_submissions", "public_ip", "geo_note"])
        for ip in ips_in_order:
            g = geo_by_ip.get(ip, {})
            w.writerow(
                [
                    ip,
                    g.get("country", ""),
                    g.get("countryCode", ""),
                    counts[ip],
                    "yes" if _is_public_ip(ip) else "no",
                    g.get("note", ""),
                ]
            )

    print("| IP | Country | Code | Reviews |")
    print("|---|---|---:|---:|")
    for ip in ips_in_order:
        g = geo_by_ip.get(ip, {})
        c = g.get("country") or "—"
        cc = g.get("countryCode") or ""
        if g.get("note"):
            c = f"{c} ({g['note']})".strip()
        print(f"| {ip} | {c} | {cc} | {counts[ip]} |")

    print(f"\nCSV: {csv_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
