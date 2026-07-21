import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OPTIMIZE_RESUME_QUERY_PARAM } from "../api";

/**
 * Legacy `/optimize/snapshot?t=…` from older emails — same flow as `/optimize?resume=…`.
 */
export default function OptimizeSnapshot() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const legacy = (params.get("t") || "").trim();
    if (legacy) {
      navigate(`/optimize?${OPTIMIZE_RESUME_QUERY_PARAM}=${encodeURIComponent(legacy)}`, { replace: true });
      return;
    }
    navigate("/", { replace: true });
  }, [navigate, params]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)]">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
        aria-hidden
      />
    </div>
  );
}
