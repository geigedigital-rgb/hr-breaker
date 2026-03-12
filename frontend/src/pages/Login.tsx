import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EnvelopeIcon, LockClosedIcon, DocumentTextIcon, LinkIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";

const LANDING_PENDING_KEY = "landing_pending_token";

function PendingLoader() {
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 shrink-0" aria-hidden>
      <span className="relative flex h-5 w-5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4578FC]/40" />
        <span className="relative inline-flex rounded-full h-5 w-5 border-2 border-[#4578FC] border-t-transparent animate-spin" />
      </span>
    </span>
  );
}

export default function Login() {
  const { user, loading, login, register, loginWithGoogle, setUserFromToken } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [showPasswordField, setShowPasswordField] = useState(false);

  const pendingToken = searchParams.get("pending");
  const [pendingData, setPendingData] = useState<api.LandingPendingResponse | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState(!!pendingToken);

  useEffect(() => {
    if (!pendingToken) return;
    setPendingLoading(true);
    api.getLandingPending(pendingToken)
      .then((data) => {
        setPendingData(data);
        setPendingError(null);
      })
      .catch((e) => setPendingError(e instanceof Error ? e.message : t("home.loadError")))
      .finally(() => setPendingLoading(false));
  }, [pendingToken]);

  const tokenFromUrl = searchParams.get("token");
  useEffect(() => {
    if (tokenFromUrl) {
      setUserFromToken(tokenFromUrl);
      navigate("/", { replace: true });
    }
  }, [tokenFromUrl, setUserFromToken, navigate]);

  useEffect(() => {
    if (!loading && user && user.id !== "local") {
      const pending = sessionStorage.getItem(LANDING_PENDING_KEY) || pendingToken;
      if (pending) {
        sessionStorage.removeItem(LANDING_PENDING_KEY);
        navigate(`/optimize?pending=${encodeURIComponent(pending)}`, { replace: true });
        return;
      }
      navigate("/", { replace: true });
    }
  }, [loading, user, navigate, pendingToken]);

  const handleGoogleClick = () => {
    if (pendingToken) sessionStorage.setItem(LANDING_PENDING_KEY, pendingToken);
    loginWithGoogle();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPasswordField) return;
    setError(null);
    setSubmitting(true);
    try {
      if (isRegister) {
        await register(email, password);
      } else {
        await login(email, password);
      }
      if (pendingToken) {
        sessionStorage.setItem(LANDING_PENDING_KEY, pendingToken);
        navigate(`/optimize?pending=${encodeURIComponent(pendingToken)}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }

  if (user && user.id !== "local") {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-[#F2F3F9]">
      {/* Left panel: gradient circles, doc icons, flow, skeleton card */}
      <div className="hidden w-[45%] min-h-screen lg:flex flex-col justify-between bg-[#1e3a5f] p-10 relative overflow-hidden">
        {/* Два светлых круга с градиентом на фоне */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute rounded-full opacity-40"
            style={{
              top: "5%",
              left: "-5%",
              width: "min(70vw, 420px)",
              height: "min(70vw, 420px)",
              background: "radial-gradient(circle at 40% 40%, rgba(147, 197, 253, 0.5), rgba(96, 165, 250, 0.2) 50%, transparent 70%)",
            }}
          />
          <div
            className="absolute rounded-full opacity-35"
            style={{
              top: "35%",
              left: "10%",
              width: "min(50vw, 280px)",
              height: "min(50vw, 280px)",
              background: "radial-gradient(circle at 50% 50%, rgba(191, 219, 254, 0.45), rgba(147, 197, 253, 0.15) 60%, transparent 75%)",
            }}
          />
        </div>

        <div className="relative z-10 font-semibold text-xl text-white tracking-tight">HR-Breaker</div>

        {/* Center: doc icons → flow → skeleton card */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-4">
          <div className="relative w-full max-w-[320px] flex items-center">
            {/* Three doc icons */}
            <div className="flex flex-col gap-8 shrink-0">
              <div className="w-12 h-12 rounded-full bg-white border border-white/30 shadow-lg flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#e11d48" fill="#fecdd3" />
                  <path d="M14 2v6h6M9 13h6M9 17h6" stroke="#e11d48" strokeLinecap="round" />
                </svg>
              </div>
              <div className="w-12 h-12 rounded-full bg-white border border-white/30 shadow-lg flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#2563eb" fill="#bfdbfe" />
                  <path d="M14 2v6h6M9 13h6M9 17h6" stroke="#2563eb" strokeLinecap="round" />
                </svg>
              </div>
              <div className="w-12 h-12 rounded-full bg-white border border-white/30 shadow-lg flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#059669" fill="#a7f3d0" />
                  <path d="M14 2v6h6M9 13h6M9 17h6" stroke="#059669" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            {/* Flow lines to card */}
            <svg className="absolute left-14 top-1/2 -translate-y-1/2 w-[calc(100%-8rem)] h-24" style={{ minWidth: 140 }}>
              <path d="M 0 12 L 28 12" stroke="rgba(255,255,255,0.4)" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M 0 36 L 28 36" stroke="rgba(255,255,255,0.4)" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M 0 60 L 28 60" stroke="rgba(255,255,255,0.4)" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M 28 12 L 28 36 L 28 60" stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M 28 36 L 36 36" stroke="rgba(255,255,255,0.4)" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M 36 36 L 120 36" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </svg>

            {/* Skeleton card "Match" */}
            <div className="ml-auto w-44 shrink-0 rounded-xl bg-white border border-white/20 shadow-xl overflow-hidden">
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-100">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </div>
              <div className="p-3 space-y-2.5">
                <div className="flex gap-2 items-center">
                  <div className="w-6 h-6 rounded-full bg-gray-200 shrink-0" />
                  <div className="h-2 flex-1 rounded bg-gray-200 max-w-[70%]" />
                </div>
                <div className="flex gap-2 items-center">
                  <div className="w-6 h-6 rounded-full bg-gray-200 shrink-0" />
                  <div className="h-2 flex-1 rounded bg-gray-200 max-w-[85%]" />
                </div>
                <div className="flex gap-2 items-center">
                  <div className="w-6 h-6 rounded-full bg-gray-200 shrink-0" />
                  <div className="h-2 flex-1 rounded bg-gray-200 max-w-[60%]" />
                </div>
              </div>
              <div className="px-3 pb-3 pt-1">
                <span className="inline-block text-xs font-semibold text-[#2563eb] bg-blue-50 px-2 py-1 rounded">Match</span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-white space-y-1">
          <p className="text-lg font-semibold">Resume meets job.</p>
          <p className="text-sm text-white/80">Optimization and ATS in one place.</p>
        </div>
      </div>

      {/* Right panel — sign-in form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[400px]">
          <h1 className="text-2xl font-bold text-[#181819] tracking-tight">{t("login.title")}</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {t("login.welcome")}
          </p>

          {/* Google sign-in button */}
          <button
            type="button"
            onClick={handleGoogleClick}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-[#dadce0] bg-white py-3 px-4 text-[#3c4043] text-sm font-medium shadow-sm transition-colors hover:bg-[#f8f9fa] hover:border-[#c6c9cc]"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {t("login.signInGoogle")}
          </button>

          {/* Divider */}
          <div className="mt-6 flex items-center gap-3">
            <span className="flex-1 h-px bg-[#EBEDF5]" />
            <span className="text-sm text-[var(--text-muted)]">{t("login.orEmail")}</span>
            <span className="flex-1 h-px bg-[#EBEDF5]" />
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-[#181819]">
                {t("login.email")}
              </label>
              <div className="relative mt-1.5">
                <EnvelopeIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setShowPasswordField(true)}
                  onClick={() => setShowPasswordField(true)}
                  className="w-full rounded-xl border border-[#EBEDF5] bg-white py-2.5 pl-10 pr-3 text-[#181819] placeholder:text-[var(--text-muted)] focus:border-[#4578FC] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                  placeholder="Email"
                />
              </div>
            </div>
            {showPasswordField && (
              <>
                <div>
                  <label htmlFor="login-password" className="block text-sm font-medium text-[#181819]">
                    {t("login.password")}
                  </label>
                  <div className="relative mt-1.5">
                    <LockClosedIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      id="login-password"
                      type="password"
                      autoComplete={isRegister ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-[#EBEDF5] bg-white py-2.5 pl-10 pr-3 text-[#181819] placeholder:text-[var(--text-muted)] focus:border-[#4578FC] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30"
                      placeholder={t("login.password")}
                      required
                    />
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#4578FC] py-3 text-sm font-medium text-white transition-colors hover:bg-[#3a6ae0] disabled:opacity-60"
                >
                  {submitting ? "…" : isRegister ? t("login.register") : t("login.signIn")}
                </button>
                <button
                  type="button"
                  onClick={() => { setIsRegister((r) => !r); setError(null); }}
                  className="w-full text-sm text-[var(--text-muted)] hover:text-[#181819]"
                >
                  {isRegister ? t("login.haveAccount") : t("login.noAccount")}
                </button>
              </>
            )}
          </form>

          {/* Landing "files ready" block */}
          {pendingToken && (
            <div className="mt-10 pt-8 border-t border-[#EBEDF5]">
              <p className="text-base font-semibold text-[#181819]">
                {t("login.filesReady")}
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {t("login.signInToSee")}
              </p>
              {pendingLoading && (
                <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#F5F6FA] border border-[#EBEDF5] px-4 py-3">
                  <PendingLoader />
                  <span className="text-sm text-[var(--text-muted)]">{t("login.loading")}</span>
                </div>
              )}
              {pendingError && (
                <p className="mt-4 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  {pendingError}
                </p>
              )}
              {!pendingLoading && pendingData && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-3 rounded-xl bg-white border border-[#EBEDF5] shadow-sm px-4 py-3.5">
                    <PendingLoader />
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <DocumentTextIcon className="w-5 h-5 shrink-0 text-[#4578FC]" />
                      <span className="text-sm font-medium text-[#181819] truncate" title={pendingData.resume_filename}>
                        {pendingData.resume_filename}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl bg-white border border-[#EBEDF5] shadow-sm px-4 py-3.5">
                    <PendingLoader />
                    <div className="min-w-0 flex-1 flex flex-col items-start gap-0.5">
                      {pendingData.job_title && (
                        <span className="text-sm font-medium text-[#181819]">{pendingData.job_title}</span>
                      )}
                      {pendingData.job_url ? (
                        <a
                          href={pendingData.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#4578FC] hover:underline truncate max-w-full"
                        >
                          {pendingData.job_url}
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">{t("login.jobLink")}</span>
                      )}
                    </div>
                    <LinkIcon className="w-5 h-5 shrink-0 text-[var(--text-muted)]" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
