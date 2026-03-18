import { useEffect, useMemo, useState } from "react";
import {
  ClipboardDocumentIcon,
  CheckIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowTrendingUpIcon,
  LinkIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { createPartnerLink, getPartnerMe, getPartnerTerms, type PartnerCommissionItem } from "../api";
import { t } from "../i18n";

function formatMoney(cents: number, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

function statusLabel(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "paid") return t("partner.statusPaid");
  if (s === "approved") return t("partner.statusApproved");
  if (s === "rejected" || s === "blocked") return t("partner.statusRejected");
  return t("partner.statusHold");
}

function statusClass(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "paid") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (s === "approved") return "bg-blue-100 text-blue-800 border-blue-200";
  if (s === "rejected" || s === "blocked") return "bg-rose-100 text-rose-800 border-rose-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

export default function Partner() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  const [thresholdCents, setThresholdCents] = useState(35000);
  const [eligibleCents, setEligibleCents] = useState(0);
  const [paidCents, setPaidCents] = useState(0);
  const [terms, setTerms] = useState<string[]>([]);
  const [items, setItems] = useState<PartnerCommissionItem[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [infoHover, setInfoHover] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, termsResp] = await Promise.all([getPartnerMe(), getPartnerTerms()]);
        if (cancelled) return;
        setLink(me.referral_link);
        setThresholdCents(me.payout_threshold_cents);
        setEligibleCents(me.eligible_cents);
        setPaidCents(me.paid_cents);
        setItems(me.items || []);
        setTerms(termsResp.items || []);
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

  const progress = useMemo(() => {
    if (!thresholdCents) return 0;
    return Math.max(0, Math.min(100, Math.round((eligibleCents / thresholdCents) * 100)));
  }, [eligibleCents, thresholdCents]);

  const canPayout = eligibleCents >= thresholdCents;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const onRegenerate = async () => {
    try {
      const data = await createPartnerLink();
      setLink(data.referral_link);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create partner link");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" aria-busy="true" aria-live="polite">
        <span
          className="h-9 w-9 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent"
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#F2F3F9]">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-5">
        {/* Header */}
        <header>
          <h1 className="text-xl font-semibold text-[#181819] tracking-tight">{t("partner.title")}</h1>
          <p className="mt-1 text-[13px] text-[#64748B] max-w-xl leading-snug">{t("partner.subtitle")}</p>
        </header>

        {error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-800 shadow-sm"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Balance cards: Paid out + Progress to payout */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[#EBEDF5] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[#64748B]">
                <ArrowTrendingUpIcon className="w-4 h-4" aria-hidden />
                <span className="text-[11px] font-medium uppercase tracking-wider">{t("partner.paidTotal")}</span>
              </div>
              <button
                type="button"
                disabled={!canPayout}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                  canPayout
                    ? "bg-[#4578FC] text-white border border-[#4578FC]"
                    : "cursor-not-allowed border border-[#E2E8F0] bg-[#F1F5F9] text-[#94A3B8]"
                }`}
              >
                {t("partner.withdraw")}
              </button>
            </div>
            <p className="mt-1.5 text-lg font-semibold text-[#181819] tabular-nums">{formatMoney(paidCents)}</p>
            <p className="mt-0.5 text-[11px] text-[#94A3B8]">{t("partner.paidOutHint")}</p>
          </div>

          <div
            className={`rounded-xl border overflow-visible ${
              canPayout ? "border-emerald-200 bg-emerald-50/50" : "border-[#EBEDF5] bg-white"
            } p-4 shadow-sm`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#64748B]">{t("partner.payoutProgress")}</span>
              <span
                className="relative inline-flex shrink-0 cursor-help"
                onMouseEnter={() => setInfoHover(true)}
                onMouseLeave={() => setInfoHover(false)}
                aria-label={t("partner.payoutThresholdNote")}
              >
                <InformationCircleIcon className="w-4 h-4 text-[#94A3B8]" />
                {infoHover && (
                  <span
                    role="tooltip"
                    className="absolute left-1/2 bottom-full z-50 mb-1.5 -translate-x-1/2 max-w-[260px] rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[11px] font-normal text-[#475569] leading-snug shadow-md"
                  >
                    {t("partner.payoutThresholdNote")}
                  </span>
                )}
              </span>
            </div>
            <p className="mt-1.5 text-lg font-semibold text-[#181819] tabular-nums">
              {formatMoney(eligibleCents)} <span className="text-sm font-medium text-[#94A3B8]">/ {formatMoney(thresholdCents)}</span>
            </p>
            <div className="mt-2.5 h-2 rounded-full bg-[#E2E8F0] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#4578FC] transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            {canPayout && (
              <p className="mt-1.5 text-[11px] font-medium text-emerald-700">{t("partner.eligibleForPayout")}</p>
            )}
          </div>
        </section>

        {/* Share link */}
        <section className="rounded-xl border border-[#EBEDF5] bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[#181819]">
            <LinkIcon className="w-4 h-4 text-[#4578FC]" aria-hidden />
            <h2 className="text-[13px] font-medium">{t("partner.shareLink")}</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-[#64748B]">{t("partner.shareLinkHint")}</p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <div className="flex-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 text-[13px] text-[#334155] font-mono break-all select-all">
              {link}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onCopy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-[13px] font-medium shadow-sm ${
                  copied
                    ? "bg-emerald-600 text-white border border-emerald-600"
                    : "bg-[#4578FC] text-white border border-[#4578FC]"
                }`}
              >
                {copied ? (
                  <>
                    <CheckIcon className="w-4 h-4" aria-hidden />
                    {t("partner.copied")}
                  </>
                ) : (
                  <>
                    <ClipboardDocumentIcon className="w-4 h-4" aria-hidden />
                    {t("partner.copy")}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6DAE8] bg-white px-3 py-2.5 text-[13px] font-medium text-[#475569]"
                title={t("partner.refreshLink")}
              >
                <ArrowPathIcon className="w-4 h-4" aria-hidden />
                <span className="hidden sm:inline">{t("partner.refreshLink")}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Rules — collapsible */}
        <section className="rounded-xl border border-[#EBEDF5] bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setRulesOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            aria-expanded={rulesOpen}
          >
            <h2 className="text-[13px] font-medium text-[#181819]">{t("partner.rules")}</h2>
            {rulesOpen ? (
              <ChevronUpIcon className="w-4 h-4 text-[#64748B]" aria-hidden />
            ) : (
              <ChevronDownIcon className="w-4 h-4 text-[#64748B]" aria-hidden />
            )}
          </button>
          {rulesOpen && (
            <div className="px-4 pb-4 pt-0 border-t border-[#EBEDF5]">
              <ul className="space-y-1.5 text-[13px] text-[#475569] leading-relaxed">
                {terms.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-[#4578FC] mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Earnings activity */}
        <section className="rounded-xl border border-[#EBEDF5] bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EBEDF5]">
            <h2 className="text-[13px] font-medium text-[#181819]">{t("partner.activity")}</h2>
            <p className="mt-0.5 text-[11px] text-[#64748B]">{t("partner.activityDesc")}</p>
          </div>
          {!items.length ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-[#64748B]">{t("partner.empty")}</p>
              <p className="mt-1 text-[11px] text-[#94A3B8] max-w-sm mx-auto">{t("partner.emptyHint")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#EEF1FB]">
              {items.map((row, idx) => (
                <li
                  key={`${row.created_at}-${idx}`}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#181819] truncate">
                      {row.invited_email || "—"}
                    </p>
                    <p className="text-[11px] text-[#64748B] mt-0.5">
                      {new Date(row.created_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-sm font-semibold text-[#181819] tabular-nums">
                      {formatMoney(row.amount_cents, row.currency)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(row.status)}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
