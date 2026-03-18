import { useEffect, useState } from "react";
import {
  adminReferralApprove,
  adminReferralBlock,
  adminReferralHold,
  adminReferralReject,
  getAdminReferralChains,
  getAdminReferralEvents,
  type AdminReferralChainItem,
  type AdminReferralEventItem,
} from "../../api";
import { t } from "../../i18n";

export default function AdminReferrals() {
  const [chains, setChains] = useState<AdminReferralChainItem[]>([]);
  const [events, setEvents] = useState<AdminReferralEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    const [chainsResp, eventsResp] = await Promise.all([
      getAdminReferralChains(200),
      getAdminReferralEvents(200),
    ]);
    setChains(chainsResp.items || []);
    setEvents(eventsResp.items || []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onAction = async (
    row: AdminReferralChainItem,
    action: "approve" | "reject" | "hold" | "block"
  ) => {
    if (!row.commission_id) return;
    setBusyId(row.id);
    setError(null);
    try {
      if (action === "approve") await adminReferralApprove(row.commission_id);
      if (action === "reject") await adminReferralReject(row.commission_id);
      if (action === "hold") await adminReferralHold(row.commission_id);
      if (action === "block") await adminReferralBlock(row.commission_id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" aria-busy="true" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">{t("admin.nav.referrals")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">Affiliate chains, statuses, and anti-abuse events.</p>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-[#EBEDF5] bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EBEDF5]">
          <h3 className="text-sm font-semibold text-[#181819]">Chains</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8F9FC] text-[#6B7280]">
              <tr>
                <th className="px-3 py-2 text-left">Referrer</th>
                <th className="px-3 py-2 text-left">Invited</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Commission</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {chains.map((row) => (
                <tr key={row.id} className="border-t border-[#EEF1FB]">
                  <td className="px-3 py-2">{row.referrer_email || "-"}</td>
                  <td className="px-3 py-2">{row.invited_email || "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2">{row.amount_cents != null ? `$${(row.amount_cents / 100).toFixed(2)}` : "-"}</td>
                  <td className="px-3 py-2">{row.commission_status || row.attribution_status}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!row.commission_id || busyId === row.id}
                        onClick={() => onAction(row, "approve")}
                        className="rounded border border-[#D6DAE8] px-2 py-1 text-xs hover:bg-[#F8F9FC] disabled:opacity-50"
                      >
                        approve
                      </button>
                      <button
                        type="button"
                        disabled={!row.commission_id || busyId === row.id}
                        onClick={() => onAction(row, "reject")}
                        className="rounded border border-[#D6DAE8] px-2 py-1 text-xs hover:bg-[#F8F9FC] disabled:opacity-50"
                      >
                        reject
                      </button>
                      <button
                        type="button"
                        disabled={!row.commission_id || busyId === row.id}
                        onClick={() => onAction(row, "hold")}
                        className="rounded border border-[#D6DAE8] px-2 py-1 text-xs hover:bg-[#F8F9FC] disabled:opacity-50"
                      >
                        hold
                      </button>
                      <button
                        type="button"
                        disabled={!row.commission_id || busyId === row.id}
                        onClick={() => onAction(row, "block")}
                        className="rounded border border-[#D6DAE8] px-2 py-1 text-xs hover:bg-[#F8F9FC] disabled:opacity-50"
                      >
                        block
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!chains.length && (
                <tr>
                  <td className="px-3 py-6 text-[var(--text-muted)]" colSpan={6}>No referral chains yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EBEDF5]">
          <h3 className="text-sm font-semibold text-[#181819]">Events</h3>
        </div>
        <div className="max-h-[320px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8F9FC] text-[#6B7280]">
              <tr>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Referrer</th>
                <th className="px-3 py-2 text-left">Invited</th>
                <th className="px-3 py-2 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-t border-[#EEF1FB]">
                  <td className="px-3 py-2">{ev.event_type}</td>
                  <td className="px-3 py-2">{ev.referrer_email || "-"}</td>
                  <td className="px-3 py-2">{ev.invited_email || "-"}</td>
                  <td className="px-3 py-2">{new Date(ev.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {!events.length && (
                <tr>
                  <td className="px-3 py-6 text-[var(--text-muted)]" colSpan={4}>No events yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
