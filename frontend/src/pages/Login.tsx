import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EnvelopeIcon, LockClosedIcon, DocumentTextIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";

const LANDING_PENDING_KEY = "landing_pending_token";
const PARTNER_REF_CODE_KEY = "partner_ref_code";
const PARTNER_REF_SRC_KEY = "partner_ref_source";
const SIGNUP_SUCCESS_KEY = "signup_success_pending";
const SIGNUP_NEXT_KEY = "signup_success_next";

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

  const refFromUrl = searchParams.get("ref");
  useEffect(() => {
    if (!refFromUrl) return;
    sessionStorage.setItem(PARTNER_REF_CODE_KEY, refFromUrl.trim().toLowerCase());
    sessionStorage.setItem(PARTNER_REF_SRC_KEY, window.location.href);
  }, [refFromUrl]);

  const tokenFromUrl = searchParams.get("token");
  useEffect(() => {
    if (tokenFromUrl) {
      setUserFromToken(tokenFromUrl);
      navigate("/", { replace: true });
    }
  }, [tokenFromUrl, setUserFromToken, navigate]);

  useEffect(() => {
    if (!loading && user && user.id !== "local") {
      if (sessionStorage.getItem(SIGNUP_SUCCESS_KEY) === "1") {
        navigate("/signup-success", { replace: true });
        return;
      }
      const pending = sessionStorage.getItem(LANDING_PENDING_KEY) || pendingToken;
      if (pending) {
        sessionStorage.removeItem(LANDING_PENDING_KEY);
        navigate(`/optimize?pending=${encodeURIComponent(pending)}`, { replace: true });
        return;
      }
      const refCode = sessionStorage.getItem(PARTNER_REF_CODE_KEY);
      if (refCode) {
        navigate("/optimize", { replace: true });
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
      const referral = {
        code: sessionStorage.getItem(PARTNER_REF_CODE_KEY),
        source_url: sessionStorage.getItem(PARTNER_REF_SRC_KEY),
      };
      if (isRegister) {
        await register(email, password, referral);
        const nextPath = pendingToken
          ? `/optimize?pending=${encodeURIComponent(pendingToken)}`
          : "/optimize";
        sessionStorage.setItem(SIGNUP_SUCCESS_KEY, "1");
        sessionStorage.setItem(SIGNUP_NEXT_KEY, nextPath);
        navigate("/signup-success", { replace: true });
        return;
      } else {
        await login(email, password, referral);
      }
      if (pendingToken) {
        sessionStorage.setItem(LANDING_PENDING_KEY, pendingToken);
        navigate(`/optimize?pending=${encodeURIComponent(pendingToken)}`, { replace: true });
      } else {
        navigate("/optimize", { replace: true });
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
      <style>{`
        @keyframes login-block-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .login-block-1 { animation: login-block-in 0.4s ease-out 0.1s forwards; opacity: 0; }
        .login-block-2 { animation: login-block-in 0.4s ease-out 0.2s forwards; opacity: 0; }
        .login-block-3 { animation: login-block-in 0.4s ease-out 0.3s forwards; opacity: 0; }
      `}</style>
      {/* Left panel: visible background + resume card with shadow + asymmetric blocks */}
      <div
        className="hidden w-[45%] min-h-screen lg:flex flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: "linear-gradient(105deg, #faf5ff 0%, #fce7f3 100%)" }}
      >
        <div className="relative z-10 flex items-center gap-2">
          <img src="/logo-color.svg" alt="PitchCV" className="w-8 h-8 object-contain shrink-0" />
          <div className="font-semibold text-xl text-[#0f172a] tracking-tight">PitchCV</div>
        </div>

        {/* Center: resume as a card (shadow, so background shows) + blocks placed asymmetrically */}
        <div className="relative z-10 flex-1 flex items-center justify-center min-h-0 py-6">
          <div className="relative w-full max-w-[320px] flex items-center justify-center">
            {/* Resume image inside a card with shadow */}
            <div className="w-[85%] max-h-[70vh] rounded-lg overflow-hidden bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.18),0_8px_24px_-8px_rgba(0,0,0,0.12)] border border-[#e5e7eb]/80">
              <img
                src="https://www.pitchcv.app/assets/resume-example-1.png"
                alt=""
                className="w-full h-auto object-contain object-top"
                aria-hidden
              />
            </div>

            {/* Block: percentage — top-right of resume */}
            <div className="login-block-1 absolute -top-2 right-0 bg-white p-3 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#f1f5f9] flex items-center gap-3 z-10">
              <div className="bg-[#fb7185] text-white text-lg font-bold px-2.5 py-1 rounded-lg leading-none">85%</div>
              <div className="text-sm font-semibold text-[#334155] leading-snug">ATS Match</div>
            </div>

            {/* Block: checkmarks and crosses — bottom-left of resume */}
            <div className="login-block-2 absolute bottom-4 -left-2 bg-white p-3.5 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#f1f5f9] w-[170px] z-10">
              <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-2">Skills</div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <span className="text-xs font-medium text-[#334155] truncate">Planning</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <span className="text-xs font-medium text-[#334155] truncate">Analysis</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </div>
                  <span className="text-xs font-medium text-[#64748b] truncate line-through">B2C Sales</span>
                </div>
              </div>
            </div>

            {/* Block: minimal gauge — arc + filled slider, no needle; "Interview chance" */}
            <div className="login-block-3 absolute -bottom-1 right-2 bg-white p-3 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#f1f5f9] flex items-center gap-3 z-10">
              <svg viewBox="0 0 64 36" className="w-14 h-7 shrink-0" aria-hidden>
                <defs>
                  <linearGradient id="login-mini-gauge" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#dc2626" />
                    <stop offset="50%" stopColor="#eab308" />
                    <stop offset="100%" stopColor="#16a34a" />
                  </linearGradient>
                </defs>
                {/* Thick background arc */}
                <path d="M 4 32 A 28 28 0 0 1 60 32" fill="none" stroke="#E8EAEF" strokeWidth="8" strokeLinecap="round" />
                {/* Filled portion (85%) on top — slider along the arc */}
                <path d="M 4 32 A 28 28 0 0 1 60 32" fill="none" stroke="url(#login-mini-gauge)" strokeWidth="8" strokeLinecap="round" strokeDasharray="74.8 88" strokeDashoffset="0" />
              </svg>
              <span className="text-xs font-semibold text-[#64748b]">Interview chance</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-[#0f172a] space-y-1">
          <p className="text-lg font-semibold">Resume meets job.</p>
          <p className="text-sm text-[#334155]">Optimization and ATS in one place.</p>
        </div>
      </div>

      {/* Right panel — sign-in form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-white">
        <div className="w-full max-w-[400px]">
          <h1 className="text-2xl font-bold text-[#181819] tracking-tight">{t("login.title")}</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {t("login.welcome")}
          </p>

          {/* Landing "files ready" block — highlighted and placed before login actions */}
          {pendingToken && (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="flex items-start gap-2.5">
                <CheckCircleIcon className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-800">
                    {t("login.filesReady")}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-700">
                    {t("login.signInToSee")}
                  </p>
                </div>
              </div>
              {pendingLoading && (
                <div className="mt-3 rounded-xl bg-white/80 border border-emerald-100 px-3 py-2">
                  <span className="text-xs text-[var(--text-muted)]">{t("login.loading")}</span>
                </div>
              )}
              {pendingError && (
                <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  {pendingError}
                </p>
              )}
              {!pendingLoading && pendingData && (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center gap-2.5 rounded-xl bg-white border border-[#EBEDF5] px-3 py-2.5">
                    <DocumentTextIcon className="w-4 h-4 shrink-0 text-[#4578FC]" />
                    <span className="text-xs font-medium text-[#181819] truncate" title={pendingData.resume_filename}>
                      {pendingData.resume_filename}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl bg-white border border-[#EBEDF5] px-3 py-2.5">
                    <DocumentTextIcon className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
                    <div className="min-w-0 flex-1 flex flex-col items-start gap-0.5">
                      {pendingData.job_title && (
                        <span className="text-xs font-medium text-[#181819] truncate max-w-full">{pendingData.job_title}</span>
                      )}
                      <span className="text-[11px] text-[var(--text-muted)]">{t("login.jobDescription")}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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

        </div>
      </div>
    </div>
  );
}
