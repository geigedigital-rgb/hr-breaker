import { t, tFormat } from "../../i18n";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  disabled?: boolean;
};

export default function AdminPaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  disabled,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, page * pageSize + pageSize);
  const canPrev = page > 0;
  const canNext = total > 0 && page < totalPages - 1;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shrink-0 border-t border-[#EBEDF5] bg-[var(--card)] px-3 py-2.5">
      <p className="text-xs text-[var(--text-muted)] tabular-nums" aria-live="polite">
        {tFormat(t("admin.pagination.showing"), { from: String(from), to: String(to), total: String(total) })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span>{t("admin.pagination.perPage")}</span>
          <select
            value={pageSize}
            disabled={disabled}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-lg border border-[#EBEDF5] bg-white px-2 py-1 text-sm text-[var(--text)] focus:border-[#4578FC] focus:outline-none focus:ring-1 focus:ring-[#4578FC]"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || !canPrev}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-[#EBEDF5] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[#F5F6FA] disabled:opacity-40 disabled:pointer-events-none"
          >
            {t("admin.pagination.prev")}
          </button>
          <span className="px-2 text-xs text-[var(--text-tertiary)] tabular-nums min-w-[5.5rem] text-center">
            {tFormat(t("admin.pagination.pageOf"), { n: String(page + 1), m: String(totalPages) })}
          </span>
          <button
            type="button"
            disabled={disabled || !canNext}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-[#EBEDF5] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[#F5F6FA] disabled:opacity-40 disabled:pointer-events-none"
          >
            {t("admin.pagination.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
