import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  deleteAdminUser,
  getAdminUserDetail,
  patchAdminUserBlocked,
  patchAdminUserPartnerAccess,
  patchAdminUserSubscription,
  type AdminUserDetail,
} from "../../api";
import { t, tFormat } from "../../i18n";

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

export default function AdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getAdminUserDetail(userId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!userId) {
    return <p className="text-sm text-[var(--text-muted)]">{t("admin.userDetail.noUser")}</p>;
  }

  if (loading && !detail) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="max-w-2xl space-y-4">
        <Link to="/admin/users" className="text-sm text-[#4578FC] hover:underline">
          ← {t("admin.userDetail.backToList")}
        </Link>
        <section className="rounded-xl border border-red-200 bg-red-50/80 p-4">
          <h2 className="text-sm font-semibold text-red-800">{t("admin.userDetail.loadError")}</h2>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </section>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex flex-col h-full min-h-0 max-w-4xl w-full mx-auto gap-4">
      <div className="shrink-0 flex flex-wrap items-center gap-3">
        <Link to="/admin/users" className="text-sm text-[#4578FC] hover:underline font-medium">
          ← {t("admin.userDetail.backToList")}
        </Link>
        <h2 className="text-xl font-bold text-[var(--text)]">{detail.email}</h2>
        {detail.name ? <span className="text-sm text-[var(--text-muted)]">({detail.name})</span> : null}
        {detail.admin_blocked ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-red-700 bg-red-100 px-2 py-0.5 rounded-md">
            {t("admin.userDetail.blockedBadge")}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 shrink-0">
        <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {t("admin.userDetail.whereStopped")}
          </h3>
          <p className="text-sm font-medium text-[var(--text)]">{detail.current_stage_summary}</p>
          <ul className="mt-3 space-y-1.5">
            {detail.stages.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-sm">
                <span className={s.done ? "text-emerald-600" : "text-[var(--text-tertiary)]"} aria-hidden>
                  {s.done ? "✓" : "○"}
                </span>
                <span className={s.done ? "text-[var(--text)]" : "text-[var(--text-muted)]"}>{s.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {t("admin.userDetail.account")}
          </h3>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.auth")}</dt>
              <dd>
                {detail.has_password ? t("admin.userDetail.password") : ""}
                {detail.has_password && detail.has_google ? " · " : ""}
                {detail.has_google ? t("admin.userDetail.google") : ""}
                {!detail.has_password && !detail.has_google ? "—" : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.resumesCount")}</dt>
              <dd className="tabular-nums">{detail.resume_count}</dd>
            </div>
            {detail.readiness ? (
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--text-muted)]">{t("admin.userDetail.readiness")}</dt>
                <dd>
                  {detail.readiness.stage} ({detail.readiness.score} pts, {t("admin.userDetail.streak")}:{" "}
                  {detail.readiness.streak_days})
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      {detail.referral ? (
        <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm shrink-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {t("admin.userDetail.referral")}
          </h3>
          <dl className="text-sm grid gap-1 sm:grid-cols-2">
            <div>
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refCode")}</dt>
              <dd className="font-mono">{detail.referral.code}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refReferrer")}</dt>
              <dd>{detail.referral.referrer_email ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refSource")}</dt>
              <dd className="break-all">{detail.referral.source_url ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">{t("admin.userDetail.refStatus")}</dt>
              <dd>{detail.referral.status}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
          {t("admin.userDetail.subscription")}
        </h3>
        <p className="text-sm mb-3">
          <span className="font-medium text-[var(--text)]">
            {detail.subscription.plan} / {detail.subscription.status}
          </span>
          {detail.subscription.current_period_end ? (
            <span className="text-[var(--text-muted)] ml-2">
              → {new Date(detail.subscription.current_period_end).toLocaleString()}
            </span>
          ) : null}
          <span className="text-[var(--text-tertiary)] ml-2">
            ({t("admin.userDetail.freeOps")}: {detail.subscription.free_analyses_count})
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("sub-free", () =>
                patchAdminUserSubscription(userId, {
                  subscription_status: "free",
                  subscription_plan: "free",
                  current_period_end: null,
                })
              )
            }
            className="rounded-lg border border-[#EBEDF5] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {t("admin.userDetail.presetFree")}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("sub-trial", () =>
                patchAdminUserSubscription(userId, {
                  subscription_status: "trial",
                  subscription_plan: "trial",
                  current_period_end: isoDaysFromNow(7),
                })
              )
            }
            className="rounded-lg border border-[#EBEDF5] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {t("admin.userDetail.presetTrial7")}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("sub-monthly", () =>
                patchAdminUserSubscription(userId, {
                  subscription_status: "active",
                  subscription_plan: "monthly",
                  current_period_end: isoDaysFromNow(30),
                })
              )
            }
            className="rounded-lg border border-[#EBEDF5] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#F5F6FA] disabled:opacity-50"
          >
            {t("admin.userDetail.presetMonthly30")}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#EBEDF5] bg-[var(--card)] p-4 shadow-sm shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
          {t("admin.userDetail.actions")}
        </h3>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={detail.admin_blocked}
              disabled={!!busy}
              onChange={(ev) =>
                run("block", () => patchAdminUserBlocked(userId, ev.target.checked))
              }
              className="h-4 w-4 rounded border-[#CBD5E1] text-[#4578FC]"
            />
            <span>{t("admin.userDetail.blockAccount")}</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={detail.partner_program_access}
              disabled={!!busy}
              onChange={(ev) =>
                run("partner", () => patchAdminUserPartnerAccess(userId, ev.target.checked))
              }
              className="h-4 w-4 rounded border-[#CBD5E1] text-[#4578FC]"
            />
            <span>{t("admin.users.partnerAccess")}</span>
          </label>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              if (!window.confirm(tFormat(t("admin.userDetail.deleteConfirm"), { email: detail.email }))) return;
              run("del", async () => {
                await deleteAdminUser(userId);
                navigate("/admin/users");
              });
            }}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 sm:ml-auto"
          >
            {t("admin.userDetail.deleteAccount")}
          </button>
        </div>
      </section>

      <section className="flex flex-col flex-1 min-h-0 rounded-xl border border-[#EBEDF5] bg-[var(--card)] shadow-sm overflow-hidden">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] px-4 pt-4 shrink-0">
          {t("admin.userDetail.journeyLog")}
        </h3>
        <div className="flex-1 min-h-0 overflow-auto overscroll-contain p-4 pt-2">
          <ul className="space-y-3 text-sm border-l-2 border-[#EBEDF5] ml-2 pl-4">
            {detail.journey.map((j, i) => (
              <li key={`${j.kind}-${j.at}-${i}`} className="relative">
                <span className="absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full bg-[#4578FC]" aria-hidden />
                <p className="text-xs text-[var(--text-tertiary)] tabular-nums">
                  {j.at ? new Date(j.at).toLocaleString() : "—"}
                </p>
                <p className="font-medium text-[var(--text)]">
                  {j.title}
                  {j.kind === "audit" && j.success === false ? (
                    <span className="ml-2 text-xs text-red-600">{t("admin.userDetail.failed")}</span>
                  ) : null}
                </p>
                {j.detail ? <p className="text-[var(--text-muted)] text-xs mt-0.5 break-words">{j.detail}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
