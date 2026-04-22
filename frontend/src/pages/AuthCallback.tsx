import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";

const LANDING_PENDING_KEY = "landing_pending_token";
const PARTNER_REF_CODE_KEY = "partner_ref_code";
const PARTNER_REF_SRC_KEY = "partner_ref_source";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUserFromToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const code = searchParams.get("code");

  useEffect(() => {
    if (!code) {
      setError(t("authCallback.noCode"));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const redirectUri = `${window.location.origin}/auth/callback`;
        const res = await api.exchangeGoogleCode(code, redirectUri, {
          code: sessionStorage.getItem(PARTNER_REF_CODE_KEY),
          source_url: sessionStorage.getItem(PARTNER_REF_SRC_KEY),
          partner_invite_token: (() => {
            try {
              return sessionStorage.getItem(api.PARTNER_INVITE_SIGNUP_STORAGE_KEY);
            } catch {
              return null;
            }
          })(),
        });
        try {
          sessionStorage.removeItem(api.PARTNER_INVITE_SIGNUP_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        setUserFromToken(res.access_token);
        const resumeTok = sessionStorage.getItem(api.OPTIMIZE_RESUME_SESSION_KEY);
        if (resumeTok) {
          sessionStorage.removeItem(api.OPTIMIZE_RESUME_SESSION_KEY);
          navigate(`/optimize?resume=${encodeURIComponent(resumeTok)}`, { replace: true });
          return;
        }
        const pending = sessionStorage.getItem(LANDING_PENDING_KEY);
        if (pending) {
          sessionStorage.removeItem(LANDING_PENDING_KEY);
          let improve = false;
          try {
            const d = await api.getLandingPending(pending);
            improve = Boolean(d.resume_only);
          } catch {
            /* fallback to optimize */
          }
          navigate(
            improve
              ? `/improve?pending=${encodeURIComponent(pending)}`
              : `/optimize?pending=${encodeURIComponent(pending)}`,
            { replace: true },
          );
        } else if (sessionStorage.getItem(PARTNER_REF_CODE_KEY)) {
          navigate("/optimize", { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("authCallback.error"));
      }
    })();
    return () => { cancelled = true; };
  }, [code, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl border border-[#EBEDF5] bg-white p-8 text-center">
        <p className="text-red-600">{error}</p>
        <a href="/login" className="mt-4 inline-block text-[#4578FC] hover:underline">
          {t("authCallback.backToLogin")}
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
        <p className="mt-3 text-sm text-[var(--text-muted)]">Signing in with Google…</p>
      </div>
    </div>
  );
}
