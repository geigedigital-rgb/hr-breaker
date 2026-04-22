import { useCallback, useEffect, useState } from "react";
import {
  adminReferralApprove,
  adminReferralBlock,
  adminReferralHold,
  adminReferralReject,
  createAdminPartnerInvite,
  deleteAdminPartnerInvite,
  getAdminPartnerInvites,
  getAdminReferralChains,
  getAdminReferralEvents,
  patchAdminPartnerInvite,
  type AdminPartnerInviteItem,
  type AdminReferralChainItem,
  type AdminReferralEventItem,
} from "../../api";
import { t } from "../../i18n";

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string | null {
  const s = local.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function partnerInviteLoginUrl(token: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/login?pvc_pi=${encodeURIComponent(token)}`;
}

export default function AdminReferrals() {
  const [chains, setChains] = useState<AdminReferralChainItem[]>([]);
  const [events, setEvents] = useState<AdminReferralEventItem[]>([]);
  const [invites, setInvites] = useState<AdminPartnerInviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteSectionError, setInviteSectionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createExpiresLocal, setCreateExpiresLocal] = useState("");
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
  const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);
  const [editInvite, setEditInvite] = useState<AdminPartnerInviteItem | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editExpiresLocal, setEditExpiresLocal] = useState("");

  const reloadChainsEvents = useCallback(async () => {
    const [chainsResp, eventsResp] = await Promise.all([
      getAdminReferralChains(200),
      getAdminReferralEvents(200),
    ]);
    setChains(chainsResp.items || []);
    setEvents(eventsResp.items || []);
  }, []);

  const reloadInvites = useCallback(async () => {
    const inv = await getAdminPartnerInvites();
    setInvites(inv.items || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reloadInvites();
      } catch (e) {
        if (!cancelled) {
          setInviteSectionError(e instanceof Error ? e.message : String(e));
        }
      }
      try {
        await reloadChainsEvents();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadChainsEvents, reloadInvites]);

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
      await reloadChainsEvents();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onCreateInvite = async () => {
    setInviteBusy(true);
    setInviteSectionError(null);
    try {
      const expIso = datetimeLocalToIso(createExpiresLocal);
      const res = await createAdminPartnerInvite({
        label: createLabel,
        expires_at: expIso,
      });
      setLastCreatedToken(res.token);
      setLastCreatedUrl(partnerInviteLoginUrl(res.token));
      setCreateLabel("");
      setCreateExpiresLocal("");
      setShowCreateInvite(false);
      await reloadInvites();
    } catch (e) {
      setInviteSectionError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const onSaveEditInvite = async () => {
    if (!editInvite) return;
    setInviteBusy(true);
    setInviteSectionError(null);
    try {
      await patchAdminPartnerInvite(editInvite.id, {
        label: editLabel,
        active: editActive,
        expires_at: datetimeLocalToIso(editExpiresLocal),
      });
      setEditInvite(null);
      await reloadInvites();
    } catch (e) {
      setInviteSectionError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const onDeleteInvite = async (id: string) => {
    if (!window.confirm("Delete this partner signup invite? Existing shared links will stop working.")) return;
    setInviteBusy(true);
    setInviteSectionError(null);
    try {
      await deleteAdminPartnerInvite(id);
      await reloadInvites();
    } catch (e) {
      setInviteSectionError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const openEdit = (row: AdminPartnerInviteItem) => {
    setEditInvite(row);
    setEditLabel(row.label);
    setEditActive(row.active);
    setEditExpiresLocal(isoToDatetimeLocal(row.expires_at));
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy:", text);
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
        <div className="px-4 py-3 border-b border-[#EBEDF5] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#181819]">Partner signup links</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Special <code className="text-[11px]">/login?pvc_pi=…</code> links grant partner access on first registration.
              Tokens are stored hashed; the secret is shown only once when you generate a link.
            </p>
          </div>
          <button
            type="button"
            disabled={inviteBusy}
            onClick={() => {
              setShowCreateInvite((v) => !v);
              setInviteSectionError(null);
            }}
            className="rounded-lg border border-[#4578FC] bg-[#4578FC] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {showCreateInvite ? "Cancel" : "Generate link"}
          </button>
        </div>
        {inviteSectionError && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{inviteSectionError}</div>
        )}
        {showCreateInvite && (
          <div className="px-4 py-3 border-b border-[#EBEDF5] bg-[#F8F9FC] flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[#6B7280]">Label (internal)</span>
              <input
                className="rounded border border-[#D6DAE8] px-2 py-1 text-sm min-w-[200px]"
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="e.g. Agency Q2"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[#6B7280]">Expires (optional)</span>
              <input
                type="datetime-local"
                className="rounded border border-[#D6DAE8] px-2 py-1 text-sm"
                value={createExpiresLocal}
                onChange={(e) => setCreateExpiresLocal(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={inviteBusy}
              onClick={() => void onCreateInvite()}
              className="rounded border border-[#D6DAE8] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#eef1fb] disabled:opacity-50"
            >
              Create
            </button>
          </div>
        )}
        {lastCreatedToken && lastCreatedUrl && (
          <div className="mx-4 my-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs space-y-2">
            <p className="font-medium text-amber-900">Copy now — the token is not shown again.</p>
            <div className="break-all font-mono text-[11px] text-amber-950">{lastCreatedUrl}</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                onClick={() => void copyText(lastCreatedUrl)}
              >
                Copy URL
              </button>
              <button
                type="button"
                className="rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                onClick={() => void copyText(lastCreatedToken)}
              >
                Copy token
              </button>
              <button type="button" className="rounded border border-amber-300 px-2 py-1 text-xs" onClick={() => { setLastCreatedToken(null); setLastCreatedUrl(null); }}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8F9FC] text-[#6B7280]">
              <tr>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((row) => (
                <tr key={row.id} className="border-t border-[#EEF1FB]">
                  <td className="px-3 py-2">{row.label || "—"}</td>
                  <td className="px-3 py-2">{row.active ? "yes" : "no"}</td>
                  <td className="px-3 py-2">{row.expires_at ? new Date(row.expires_at).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={inviteBusy}
                        onClick={() => openEdit(row)}
                        className="rounded border border-[#D6DAE8] px-2 py-1 text-xs hover:bg-[#F8F9FC] disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={inviteBusy}
                        onClick={() => void onDeleteInvite(row.id)}
                        className="rounded border border-[#D6DAE8] px-2 py-1 text-xs hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!invites.length && (
                <tr>
                  <td className="px-3 py-6 text-[var(--text-muted)]" colSpan={5}>
                    No admin-managed invites yet. Env <code className="text-xs">PARTNER_INVITE_SIGNUP_TOKEN</code> still works if set.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-[#EBEDF5] bg-white p-4 shadow-lg space-y-3">
            <h4 className="text-sm font-semibold text-[#181819]">Edit partner invite</h4>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[#6B7280]">Label</span>
              <input
                className="rounded border border-[#D6DAE8] px-2 py-1 text-sm"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
              Active
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[#6B7280]">Expires (leave empty for no expiry)</span>
              <input
                type="datetime-local"
                className="rounded border border-[#D6DAE8] px-2 py-1 text-sm"
                value={editExpiresLocal}
                onChange={(e) => setEditExpiresLocal(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded border border-[#D6DAE8] px-3 py-1.5 text-xs"
                onClick={() => setEditInvite(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={inviteBusy}
                className="rounded border border-[#4578FC] bg-[#4578FC] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                onClick={() => void onSaveEditInvite()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

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
