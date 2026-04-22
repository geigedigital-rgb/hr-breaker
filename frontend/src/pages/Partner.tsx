import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Analytics01Icon,
  BankIcon as HugeBankIcon,
  Bitcoin01Icon as HugeBitcoin01Icon,
  Copy01Icon,
  CreditCardIcon as HugeCreditCardIcon,
  GiftIcon,
  Link01Icon,
  MoneyReceive01Icon,
  MouseLeftClick01Icon,
  Tick01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import {
  getPartnerLeaderboard,
  getPartnerLeaderboardTop,
  getPartnerMe,
  getPartnerTerms,
  type PartnerCommissionItem,
  type PartnerLeaderboardEntry,
  type PartnerLeaderboardPage,
} from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t, tFormat } from "../i18n";

function formatMoney(cents: number, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

/** Partner funnel conversion (0–100 from API). */
function formatPartnerConversionPct(p: number): string {
  const x = typeof p === "number" && !Number.isNaN(p) ? p : 0;
  if (x <= 0) return "0%";
  const rounded = Math.round(x * 10) / 10;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${s}%`;
}

function PartnerHugeIcon({
  icon,
  size = 20,
  className,
  "aria-hidden": ariaHidden = true,
}: {
  icon: typeof Link01Icon;
  size?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <span className={`inline-flex shrink-0 ${className ?? ""}`} aria-hidden={ariaHidden}>
      <HugeiconsIcon icon={icon} size={size} color="currentColor" strokeWidth={1.5} />
    </span>
  );
}

/** Earned column: explicit + for credits (non-negative). */
function formatEarnedCell(cents: number, currency: string = "usd"): string {
  const c = cents || 0;
  if (c < 0) return formatMoney(c, currency);
  return `+${formatMoney(c, currency)}`;
}

/** Booked total in leaderboard: em dash when nothing beyond paid in this period. */
function formatLeaderboardBookedCell(
  accruedCents: number,
  paidOutCents: number,
  currency: string,
  emptyLabel: string,
): string {
  const a = accruedCents || 0;
  const p = paidOutCents || 0;
  if (a === p) return emptyLabel;
  return formatMoney(a, currency);
}

type RowKind = "paid" | "pending" | "active" | "refunded";

function rowKind(status: string): RowKind {
  const s = (status || "").toLowerCase();
  if (s === "paid") return "paid";
  if (s === "rejected" || s === "blocked") return "refunded";
  if (s === "approved") return "active";
  return "pending";
}

function tableStatusLabel(kind: RowKind): string {
  if (kind === "paid") return t("partner.dash.statusPaid");
  if (kind === "active") return t("partner.dash.statusActive");
  if (kind === "refunded") return t("partner.dash.statusRefunded");
  return t("partner.dash.statusPending");
}

function tableBadgeClass(kind: RowKind): string {
  if (kind === "paid") return "bg-emerald-500/15 text-emerald-800 border-emerald-200/80";
  if (kind === "active") return "bg-sky-500/15 text-sky-900 border-sky-200/80";
  if (kind === "refunded") return "bg-slate-200/80 text-slate-600 border-slate-300/80";
  return "bg-amber-500/12 text-amber-900 border-amber-200/80";
}

type FilterTab = "all" | "paid" | "pending" | "refunded";

function rowMatchesFilter(kind: RowKind, tab: FilterTab): boolean {
  if (tab === "all") return true;
  if (tab === "paid") return kind === "paid";
  if (tab === "pending") return kind === "pending" || kind === "active";
  if (tab === "refunded") return kind === "refunded";
  return true;
}

function leaderboardRowClass(isYou: boolean): string {
  return isYou ? "bg-slate-50 ring-1 ring-slate-200/80" : "";
}

function leaderboardRankCell(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return String(rank);
}

function ReferralsFilterTabs({
  filterTab,
  setFilterTab,
  dash,
}: {
  filterTab: FilterTab;
  setFilterTab: (v: FilterTab) => void;
  dash: (key: string) => string;
}) {
  const tabs: { id: FilterTab; label: string }[] = [
    { id: "all", label: dash("filterAll") },
    { id: "paid", label: dash("filterPaid") },
    { id: "pending", label: dash("filterPending") },
    { id: "refunded", label: dash("filterRefunded") },
  ];
  return (
    <nav className="-mb-px flex flex-wrap gap-5 sm:gap-6" aria-label="Referral filters">
      {tabs.map(({ id, label }) => {
        const active = filterTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setFilterTab(id)}
            className={`border-b-2 pb-2.5 text-[12px] font-medium transition-colors ${
              active
                ? "border-[#4578FC] text-[#12131A]"
                : "border-transparent text-[#94A3B8] hover:border-slate-200 hover:text-[#64748B]"
            }`}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function ReferralsDataTable({
  rows,
  dash,
}: {
  rows: PartnerCommissionItem[];
  dash: (key: string) => string;
}) {
  return (
    <table className="w-full min-w-[520px] text-left text-[13px]">
      <thead>
        <tr className="border-b border-[#EEF1F6] text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
          <th className="px-4 py-3 sm:px-5">{dash("referralsColUser")}</th>
          <th className="px-3 py-3">{dash("referralsColStatus")}</th>
          <th className="px-3 py-3">{dash("referralsColPlan")}</th>
          <th className="px-3 py-3 text-right">{dash("referralsColEarned")}</th>
          <th className="px-4 py-3 sm:px-5 text-right">{dash("referralsColDate")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F1F4FA]">
        {!rows.length ? (
          <tr>
            <td colSpan={5} className="px-4 py-10 text-center text-[#64748B] sm:px-5">
              <p>{t("partner.empty")}</p>
              <p className="mt-1 text-[12px] text-[#94A3B8]">{t("partner.emptyHint")}</p>
            </td>
          </tr>
        ) : (
          rows.map((row, idx) => {
            const kind = rowKind(row.status);
            return (
              <tr key={`${row.created_at}-${idx}`} className="text-[#1e293b]">
                <td className="max-w-[200px] truncate px-4 py-3 font-medium sm:px-5">
                  {row.reason === "welcome_bonus"
                    ? t("partner.dash.referralsUserPitchCV")
                    : row.invited_email || dash("noData")}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tableBadgeClass(kind)}`}
                  >
                    {tableStatusLabel(kind)}
                  </span>
                </td>
                <td className="px-3 py-3 text-[#64748B] tabular-nums">
                  {row.reason === "welcome_bonus" ? t("partner.dash.referralsPlanWelcome") : dash("noData")}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {formatEarnedCell(row.amount_cents, row.currency)}
                </td>
                <td className="px-4 py-3 text-right text-[#64748B] sm:px-5 tabular-nums whitespace-nowrap">
                  {row.created_at
                    ? new Date(row.created_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : dash("noData")}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

type WithdrawMethod = "card" | "sepa" | "crypto";

export default function Partner() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  const [thresholdCents, setThresholdCents] = useState(35000);
  const [eligibleCents, setEligibleCents] = useState(0);
  const [paidCents, setPaidCents] = useState(0);
  const [terms, setTerms] = useState<string[]>([]);
  const [items, setItems] = useState<PartnerCommissionItem[]>([]);
  const [referralClicks, setReferralClicks] = useState(0);
  const [referralSignups, setReferralSignups] = useState(0);
  const [referralPaidUsers, setReferralPaidUsers] = useState(0);
  const [referralConvPct, setReferralConvPct] = useState(0);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [leaderboardTop, setLeaderboardTop] = useState<PartnerLeaderboardPage | null>(null);
  const [leaderboardModalOpen, setLeaderboardModalOpen] = useState(false);
  const [referralsModalOpen, setReferralsModalOpen] = useState(false);
  const [lbPage, setLbPage] = useState(1);
  const [lbData, setLbData] = useState<PartnerLeaderboardPage | null>(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState<string | null>(null);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawDesiredCents, setWithdrawDesiredCents] = useState(0);
  const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethod>("card");
  const [withdrawBanner, setWithdrawBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, termsResp, topLb] = await Promise.all([
          getPartnerMe(),
          getPartnerTerms(),
          getPartnerLeaderboardTop(5).catch(() => null),
        ]);
        if (cancelled) return;
        setLink(me.referral_link);
        setThresholdCents(me.payout_threshold_cents);
        setEligibleCents(me.eligible_cents);
        setPaidCents(me.paid_cents);
        setItems(me.items || []);
        setReferralClicks(typeof me.referral_clicks === "number" ? me.referral_clicks : 0);
        setReferralSignups(typeof me.referral_signups === "number" ? me.referral_signups : 0);
        setReferralPaidUsers(typeof me.referral_paid_users === "number" ? me.referral_paid_users : 0);
        setReferralConvPct(typeof me.referral_conversion_percent === "number" ? me.referral_conversion_percent : 0);
        setTerms(termsResp.items || []);
        setLeaderboardTop(topLb);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load partner data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadLeaderboardPage = useCallback(async (page: number) => {
    setLbLoading(true);
    setLbError(null);
    try {
      const data = await getPartnerLeaderboard(page, 10);
      setLbData(data);
    } catch (e) {
      setLbError(e instanceof Error ? e.message : t("partner.dash.leaderboardLoadError"));
      setLbData(null);
    } finally {
      setLbLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!leaderboardModalOpen) return;
    void loadLeaderboardPage(lbPage);
  }, [leaderboardModalOpen, lbPage, loadLeaderboardPage]);

  const openLeaderboardModal = () => {
    setLbPage(1);
    setLbData(null);
    setLeaderboardModalOpen(true);
  };

  const lbTotalPages = useMemo(() => {
    if (!lbData) return 1;
    return Math.max(1, Math.ceil(lbData.total / lbData.per_page));
  }, [lbData]);

  const currency = items[0]?.currency || "usd";

  const approvedUnpaidCents = useMemo(() => Math.max(0, eligibleCents - paidCents), [eligibleCents, paidCents]);

  const totalEarnedCents = useMemo(
    () =>
      items
        .filter((i) => !["rejected", "blocked"].includes((i.status || "").toLowerCase()))
        .reduce((s, i) => s + (i.amount_cents || 0), 0),
    [items],
  );

  const progressPct = useMemo(() => {
    if (!thresholdCents) return 0;
    return Math.max(0, Math.min(100, Math.round((approvedUnpaidCents / thresholdCents) * 100)));
  }, [approvedUnpaidCents, thresholdCents]);

  const withdrawSliderMax = Math.max(0, approvedUnpaidCents);

  useEffect(() => {
    if (!withdrawModalOpen) return;
    setWithdrawBanner(null);
    setWithdrawDesiredCents(withdrawSliderMax);
    setWithdrawMethod("card");
  }, [withdrawModalOpen, withdrawSliderMax]);

  const filteredItems = useMemo(() => {
    return items.filter((row) => rowMatchesFilter(rowKind(row.status), filterTab));
  }, [items, filterTab]);

  const shareText = useMemo(
    () => `Join me on PitchCV — ${link}`,
    [link],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" aria-busy="true" aria-live="polite">
        <span
          className="h-9 w-9 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent"
          aria-hidden
        />
      </div>
    );
  }

  const dash = (k: string) => t(`partner.dash.${k}`);

  return (
    <div className="min-h-full bg-[#F4F5F8] pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-5 py-6 sm:py-8 flex flex-col gap-7 sm:gap-8">
        {error && (
          <div
            className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-[13px] text-red-800 shadow-sm"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* HERO */}
        <section className="relative overflow-hidden rounded-[18px] shadow-[0_12px_40px_-12px_rgba(79,70,229,0.25)] ring-1 ring-black/[0.05]">
          <img
            src="/Frame-1686561102.svg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center"
            aria-hidden
          />
          <div className="relative z-10 grid gap-8 p-7 sm:p-9 md:grid-cols-3 md:items-center md:gap-6">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85 drop-shadow-sm">
                {dash("heroTotalEarned")}
              </p>
              <p className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight text-white drop-shadow-sm">
                {formatMoney(totalEarnedCents, currency)}
              </p>
              <p className="text-[12px] text-white/90 drop-shadow-sm">
                {dash("heroAvailableWithdraw")}{" "}
                <span className="font-semibold tabular-nums text-white">{formatMoney(approvedUnpaidCents, currency)}</span>
              </p>
            </div>
            <div className="space-y-2 md:text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85 md:mx-auto drop-shadow-sm">
                {dash("payoutProgressLabel")}
              </p>
              <p className="text-lg font-semibold tabular-nums text-white drop-shadow-sm">
                {formatMoney(approvedUnpaidCents, currency)}{" "}
                <span className="font-medium text-white/75">/ {formatMoney(thresholdCents, currency)}</span>
              </p>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/25 md:max-w-xs md:mx-auto">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-500 ease-out shadow-sm"
                  style={{ width: `${progressPct}%` }}
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="text-[11px] text-white/85 md:max-w-xs md:mx-auto leading-snug drop-shadow-sm">
                {tFormat(dash("payoutProgressHint"), { amount: formatMoney(thresholdCents, currency) })}
              </p>
            </div>
            <div className="flex md:justify-end">
              <button
                type="button"
                onClick={() => setWithdrawModalOpen(true)}
                className="w-full md:w-auto rounded-xl bg-white px-5 py-3 text-[14px] font-semibold text-violet-900 shadow-lg transition hover:bg-white/95 active:scale-[0.99] md:min-w-[180px]"
              >
                {t("partner.withdrawFunds")}
              </button>
            </div>
          </div>
        </section>

        {/* REFERRAL LINK */}
        <section className="rounded-2xl border border-[#E8EAF2] bg-white p-5 sm:p-6 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:justify-between">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-center gap-2 text-[#12131A]">
                <PartnerHugeIcon icon={Link01Icon} size={18} className="shrink-0 text-[#4578FC]" aria-hidden />
                <h2 className="text-[14px] font-semibold">{dash("referralLinkLabel")}</h2>
              </div>
              <p className="text-[12px] text-[#64748B] leading-snug">{t("partner.shareLinkHint")}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <div className="min-h-[44px] flex-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 font-mono text-[12px] sm:text-[13px] text-[#334155] break-all leading-snug">
                  {link}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onCopy}
                    className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-sm min-h-[44px] ${
                      copied ? "bg-emerald-600 text-white" : "bg-[#4578FC] text-white hover:bg-[#3d6ae8]"
                    }`}
                  >
                    {copied ? (
                      <PartnerHugeIcon icon={Tick01Icon} size={18} className="text-white" />
                    ) : (
                      <PartnerHugeIcon icon={Copy01Icon} size={18} className="text-white" />
                    )}
                    {copied ? t("partner.copied") : t("partner.copy")}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#475569] hover:bg-slate-50"
                >
                  X / Twitter
                </a>
                <a
                  href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#475569] hover:bg-slate-50"
                >
                  LinkedIn
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent("PitchCV")}&body=${encodeURIComponent(shareText)}`}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#475569] hover:bg-slate-50"
                >
                  Email
                </a>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FAFBFF] px-6 py-5 text-center lg:max-w-[220px]">
              <PartnerHugeIcon icon={GiftIcon} size={40} className="text-[#4578FC]" />
              <p className="text-[12px] font-medium leading-snug text-[#475569]">{dash("earnBlurb")}</p>
            </div>
          </div>
        </section>

        {/* METRICS */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              icon: MouseLeftClick01Icon,
              label: dash("metricsClicks"),
              k: "clicks",
              value: String(referralClicks),
            },
            {
              icon: UserGroupIcon,
              label: dash("metricsSignups"),
              k: "signups",
              value: String(referralSignups),
            },
            {
              icon: MoneyReceive01Icon,
              label: dash("metricsPaidUsers"),
              k: "paid",
              value: String(referralPaidUsers),
            },
            {
              icon: Analytics01Icon,
              label: dash("metricsConversion"),
              k: "conv",
              value: formatPartnerConversionPct(referralConvPct),
            },
          ].map(({ icon: metricIcon, label, k, value }) => (
            <div
              key={k}
              className="flex min-h-[100px] flex-col justify-between rounded-2xl border border-[#E8EAF2] bg-white p-4 shadow-sm"
            >
              <PartnerHugeIcon icon={metricIcon} size={20} className="text-[#94A3B8]" />
              <div>
                <p className="mt-2 text-xl font-semibold tabular-nums text-[#12131A]">{value}</p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#64748B]">{label}</p>
              </div>
            </div>
          ))}
        </section>

        {/* TWO COLUMN: TABLE + LEADERBOARD */}
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(300px,380px)] lg:items-start">
          <section className="overflow-hidden rounded-2xl border border-[#E8EAF2] bg-white shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)]">
            <div className="border-b border-[#EEF1F6] px-4 pb-0 pt-4 sm:px-5 sm:pt-5">
              <h2 className="text-[14px] font-semibold text-[#12131A]">{dash("referralsTitle")}</h2>
              <div className="mt-3">
                <ReferralsFilterTabs filterTab={filterTab} setFilterTab={setFilterTab} dash={dash} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <ReferralsDataTable rows={filteredItems} dash={dash} />
            </div>
            <button
              type="button"
              onClick={() => setReferralsModalOpen(true)}
              className="mx-4 mb-4 mt-4 w-[calc(100%-2rem)] rounded-xl border border-[#E2E8F0] bg-white py-2.5 text-center text-[12px] font-semibold text-[#4578FC] hover:bg-[#F8FAFC] sm:mx-5 sm:mb-5 sm:w-[calc(100%-2.5rem)]"
            >
              {dash("referralsViewFull")}
            </button>
          </section>

          <aside className="overflow-hidden rounded-2xl border border-[#E8EAF2] bg-white p-4 sm:p-5 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)]">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[14px] font-semibold leading-snug text-[#12131A]">{dash("leaderboardTitle")}</h2>
              <p className="max-w-[7.5rem] shrink-0 text-right text-[10px] font-normal leading-snug text-[#94A3B8] sm:max-w-none">
                {dash("leaderboardPeriodHint")}
              </p>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#EEF1F6] bg-white">
              <table className="w-full min-w-[260px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#EEF1F6] bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <th className="px-2.5 py-2">{dash("leaderboardColRank")}</th>
                    <th className="px-2 py-2">{dash("leaderboardColPartner")}</th>
                    <th className="px-2 py-2 text-right" title={dash("leaderboardColPaidOutHint")}>
                      {dash("leaderboardColPaidOut")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F4FA]">
                  {!leaderboardTop?.items?.length ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-[#94A3B8]">
                        {dash("leaderboardEmpty")}
                      </td>
                    </tr>
                  ) : (
                    leaderboardTop.items.map((row: PartnerLeaderboardEntry) => (
                      <tr key={row.user_id} className={leaderboardRowClass(row.is_you)}>
                        <td className="px-2.5 py-2.5 tabular-nums text-[#64748B] whitespace-nowrap">
                          {leaderboardRankCell(row.rank)}
                        </td>
                        <td className="max-w-[120px] truncate px-2 py-2.5 font-medium text-[#334155]">
                          {row.display_name}
                          {row.is_you ? (
                            <span className="ml-1 text-[10px] font-semibold uppercase text-violet-600">
                              ({dash("leaderboardYou")})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-[#12131A]">
                          {formatMoney(row.total_paid_out_cents, currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={openLeaderboardModal}
              className="mt-4 w-full rounded-xl border border-[#E2E8F0] bg-white py-2.5 text-center text-[12px] font-semibold text-[#4578FC] hover:bg-[#F8FAFC]"
            >
              {dash("leaderboardViewFull")}
            </button>
          </aside>
        </div>

        <Transition show={leaderboardModalOpen} as={Fragment}>
          <Dialog onClose={() => setLeaderboardModalOpen(false)} className="relative z-[60]">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/40" aria-hidden />
            </Transition.Child>
            <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#E8EAF2] bg-white shadow-xl">
                  <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EEF1F6] px-4 py-3 sm:px-5">
                    <div className="min-w-0 pr-2">
                      <Dialog.Title className="text-[15px] font-semibold leading-snug text-[#12131A]">
                        {dash("leaderboardModalTitle")}
                      </Dialog.Title>
                      <p className="mt-1 text-[10px] font-normal leading-snug text-[#94A3B8]">
                        {dash("leaderboardPeriodHint")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLeaderboardModalOpen(false)}
                      className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-medium text-[#64748B] hover:bg-slate-100"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto px-2 py-3 sm:px-4">
                    {lbError && (
                      <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-800">{lbError}</p>
                    )}
                    {lbLoading && !lbData ? (
                      <div className="flex justify-center py-12">
                        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" />
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-[#EEF1F6] bg-white">
                        <table className="w-full min-w-[420px] text-left text-[12px] sm:text-[13px]">
                          <thead>
                            <tr className="border-b border-[#EEF1F6] bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                              <th className="sticky top-0 z-[1] bg-[#F8FAFC] px-2 py-2 sm:px-2.5">{dash("leaderboardColRank")}</th>
                              <th className="sticky top-0 z-[1] bg-[#F8FAFC] px-2 py-2">{dash("leaderboardColPartner")}</th>
                              <th
                                className="sticky top-0 z-[1] bg-[#F8FAFC] px-2 py-2 text-right"
                                title={dash("leaderboardColPaidOutHint")}
                              >
                                {dash("leaderboardColPaidOut")}
                              </th>
                              <th
                                className="sticky top-0 z-[1] bg-[#F8FAFC] px-2 py-2 text-right"
                                title={dash("leaderboardColBookedHint")}
                              >
                                {dash("leaderboardColBooked")}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F1F4FA]">
                            {(lbData?.items || []).map((row) => (
                              <tr key={row.user_id} className={leaderboardRowClass(row.is_you)}>
                                <td className="px-2 py-2.5 tabular-nums text-[#64748B] sm:px-2.5">
                                  {leaderboardRankCell(row.rank)}
                                </td>
                                <td className="max-w-[160px] truncate px-2 py-2.5 font-medium text-[#334155]">
                                  {row.display_name}
                                  {row.is_you ? (
                                    <span className="ml-1 text-[10px] font-semibold uppercase text-violet-600">
                                      ({dash("leaderboardYou")})
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                                  {formatMoney(row.total_paid_out_cents, currency)}
                                </td>
                                <td className="px-2 py-2.5 text-right tabular-nums text-[#475569]">
                                  {formatLeaderboardBookedCell(
                                    row.accrued_total_cents,
                                    row.total_paid_out_cents,
                                    currency,
                                    dash("noData"),
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 border-t border-[#EEF1F6] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <p className="text-[12px] text-[#64748B]">
                      {tFormat(dash("leaderboardPageOf"), { page: lbData?.page ?? lbPage, totalPages: lbTotalPages })}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={lbLoading || lbPage <= 1}
                        onClick={() => setLbPage((p) => Math.max(1, p - 1))}
                        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#334155] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
                      >
                        {dash("leaderboardPrev")}
                      </button>
                      <button
                        type="button"
                        disabled={lbLoading || lbPage >= lbTotalPages}
                        onClick={() => setLbPage((p) => p + 1)}
                        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#334155] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
                      >
                        {dash("leaderboardNext")}
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </Dialog>
        </Transition>

        <Transition show={referralsModalOpen} as={Fragment}>
          <Dialog onClose={() => setReferralsModalOpen(false)} className="relative z-[60]">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/40" aria-hidden />
            </Transition.Child>
            <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#E8EAF2] bg-white shadow-xl">
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#EEF1F6] px-4 py-3 sm:px-5">
                    <Dialog.Title className="text-[15px] font-semibold text-[#12131A]">
                      {dash("referralsModalTitle")}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={() => setReferralsModalOpen(false)}
                      className="rounded-lg px-2 py-1 text-[13px] font-medium text-[#64748B] hover:bg-slate-100"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="shrink-0 border-b border-[#EEF1F6] px-4 pb-3 pt-1 sm:px-5">
                    <ReferralsFilterTabs filterTab={filterTab} setFilterTab={setFilterTab} dash={dash} />
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto px-2 py-3 sm:px-4">
                    <ReferralsDataTable rows={filteredItems} dash={dash} />
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </Dialog>
        </Transition>

        <Transition show={withdrawModalOpen} as={Fragment}>
          <Dialog onClose={() => setWithdrawModalOpen(false)} className="relative z-[70]">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/45" aria-hidden />
            </Transition.Child>
            <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E8EAF2] bg-white shadow-2xl ring-1 ring-black/5">
                  <div className="relative border-b border-[#E8EAF2] bg-[#E8EBF2] px-6 pb-7 pt-8 sm:px-7 sm:pb-8 sm:pt-9">
                    <button
                      type="button"
                      onClick={() => setWithdrawModalOpen(false)}
                      className="absolute right-3 top-3 z-20 rounded-lg px-2.5 py-1 text-[12px] font-medium text-[#64748B] hover:bg-slate-100"
                    >
                      {dash("withdrawModalClose")}
                    </button>
                    <div className="relative z-10 space-y-3 text-center">
                      <Dialog.Title className="pr-10 text-left text-lg font-semibold text-[#12131A] sm:text-center sm:pr-0">
                        {dash("withdrawModalTitle")}
                      </Dialog.Title>
                      {withdrawBanner ? (
                        <p
                          role="status"
                          className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-left text-[12px] font-semibold leading-snug text-amber-900 sm:text-center"
                        >
                          {withdrawBanner}
                        </p>
                      ) : null}
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748B]">
                        {dash("withdrawProgressTitle")}
                      </p>
                      <p className="text-base font-semibold tabular-nums text-[#12131A]">
                        {formatMoney(approvedUnpaidCents, currency)}{" "}
                        <span className="font-medium text-[#94A3B8]">/ {formatMoney(thresholdCents, currency)}</span>
                      </p>
                      <div className="mx-auto h-2.5 w-full max-w-[280px] overflow-hidden rounded-full bg-[#E2E8F0]">
                        <div
                          className="h-full rounded-full bg-[#4578FC] shadow-sm transition-[width] duration-300"
                          style={{ width: `${progressPct}%` }}
                          role="progressbar"
                          aria-valuenow={progressPct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 bg-white px-6 py-5 sm:px-7">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                        {dash("withdrawAccountName")}
                      </label>
                      <input
                        readOnly
                        value={(user?.name && user.name.trim()) || user?.email || ""}
                        className="mt-1 w-full rounded-xl border border-[#E8EAF2] bg-[#F8FAFC] px-3 py-2.5 text-[14px] text-[#334155]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                        {dash("withdrawTotalBalance")}
                      </label>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-[#12131A]">
                        {formatMoney(approvedUnpaidCents, currency)}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-end justify-between gap-2">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                          {dash("withdrawDesired")}
                        </label>
                        <span className="text-[14px] font-semibold tabular-nums text-[#12131A]">
                          {formatMoney(Math.min(withdrawDesiredCents, withdrawSliderMax), currency)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={withdrawSliderMax > 0 ? withdrawSliderMax : 1}
                        step={withdrawSliderMax > 10_000 ? 100 : withdrawSliderMax > 0 ? 50 : 1}
                        disabled={withdrawSliderMax <= 0}
                        value={withdrawSliderMax <= 0 ? 0 : Math.min(withdrawDesiredCents, withdrawSliderMax)}
                        onChange={(e) => setWithdrawDesiredCents(Number(e.target.value))}
                        className="mt-2 h-2 w-full cursor-pointer accent-[#4578FC] disabled:cursor-not-allowed disabled:opacity-40"
                      />
                      <p className="mt-1 text-[11px] text-[#64748B]">
                        {tFormat(dash("withdrawMinPayout"), { amount: formatMoney(thresholdCents, currency) })}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                        {dash("withdrawPayoutMethod")}
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {(
                          [
                            { id: "card" as const, label: dash("withdrawMethodCard"), icon: HugeCreditCardIcon },
                            { id: "sepa" as const, label: dash("withdrawMethodSepa"), icon: HugeBankIcon },
                            { id: "crypto" as const, label: dash("withdrawMethodCrypto"), icon: HugeBitcoin01Icon },
                          ] as const
                        ).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setWithdrawMethod(m.id)}
                            className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-3 text-[11px] font-semibold leading-tight transition sm:text-[12px] ${
                              withdrawMethod === m.id
                                ? "border-[#4578FC] bg-violet-50 text-[#12131A] ring-2 ring-[#4578FC]/25"
                                : "border-[#E8EAF2] bg-white text-[#475569] hover:border-slate-300"
                            }`}
                          >
                            <PartnerHugeIcon icon={m.icon} size={22} className="text-[#4578FC]" />
                            <span className="text-center">{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setWithdrawBanner(
                          tFormat(dash("withdrawBannerThreshold"), {
                            amount: formatMoney(thresholdCents, currency),
                          }),
                        )
                      }
                      className="w-full rounded-xl bg-[#4578FC] py-3 text-[14px] font-semibold text-white shadow-sm hover:bg-[#3d6ae8]"
                    >
                      {dash("withdrawSubmit")}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </Dialog>
        </Transition>

        {/* RULES */}
        <footer className="space-y-3 rounded-2xl border border-[#E8EAF2] bg-white/80 px-5 py-5 text-[12px] leading-relaxed text-[#64748B] shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">{dash("rulesFooterTitle")}</p>
          <ul className="list-disc space-y-1 pl-4 marker:text-[#CBD5E1]">
            <li>{tFormat(dash("payoutProgressHint"), { amount: formatMoney(thresholdCents, currency) })}</li>
            <li>{dash("rulesFooterSelf")}</li>
            <li>{dash("rulesFooterManual")}</li>
          </ul>
          {terms.length > 0 && (
            <ul className="list-disc space-y-1 border-t border-[#EEF1F6] pt-3 pl-4 text-[11px] text-[#94A3B8] marker:text-[#CBD5E1]">
              {terms.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </footer>
      </div>
    </div>
  );
}
