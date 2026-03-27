import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../contexts/AuthContext";

const SIGNUP_SUCCESS_KEY = "signup_success_pending";
const SIGNUP_NEXT_KEY = "signup_success_next";

export default function SignupSuccess() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    const isSignupSuccess = sessionStorage.getItem(SIGNUP_SUCCESS_KEY) === "1";
    if (!isSignupSuccess || !user || user.id === "local") {
      navigate("/login", { replace: true });
      return;
    }

    const nextPath = sessionStorage.getItem(SIGNUP_NEXT_KEY) || "/optimize";
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(SIGNUP_SUCCESS_KEY);
      sessionStorage.removeItem(SIGNUP_NEXT_KEY);
      navigate(nextPath, { replace: true });
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F3F9]">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F2F3F9] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#EBEDF5] bg-white p-6 text-center shadow-sm">
        <CheckCircleIcon className="mx-auto h-10 w-10 text-emerald-600" />
        <h1 className="mt-3 text-xl font-semibold text-[#181819]">Account created</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Registration successful. Redirecting to your workspace...</p>
      </div>
    </div>
  );
}

