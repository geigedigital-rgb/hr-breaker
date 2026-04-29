import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "../api";
import { setStoredToken } from "../api";
import { trackAuthConversion } from "../analyticsAuth";
import { clearAdminPipelineLogOnLogout, setAdminPipelineCapture } from "../adminPipelineLogStore";

type AuthContextValue = {
  user: api.AuthUser | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    referral?: { code?: string | null; source_url?: string | null },
    partnerInviteToken?: string | null,
  ) => Promise<void>;
  register: (
    email: string,
    password: string,
    referral?: { code?: string | null; source_url?: string | null },
    partnerInviteToken?: string | null,
  ) => Promise<void>;
  loginWithGoogle: () => void;
  logout: () => void;
  setUserFromToken: (token: string) => void;
  /** Refetch /auth/me to update readiness after upload/optimize. */
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (!api.getStoredToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = useCallback(
    async (email: string, password: string, referral?: { code?: string | null; source_url?: string | null }) => {
      const res = await api.login(email, password, referral);
      setStoredToken(res.access_token);
      setUser(res.user);
      trackAuthConversion({
        registration: Boolean(res.registration),
        method: "email",
      });
      void loadUser();
    },
    [loadUser]
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      referral?: { code?: string | null; source_url?: string | null },
      partnerInviteToken?: string | null,
    ) => {
      const res = await api.register(email, password, referral, partnerInviteToken);
      setStoredToken(res.access_token);
      setUser(res.user);
      trackAuthConversion({
        registration: true,
        method: "email",
      });
      void loadUser();
    },
    [loadUser]
  );

  const loginWithGoogle = useCallback(() => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    window.location.href = api.getGoogleLoginUrl(redirectUri);
  }, []);

  const logout = useCallback(() => {
    clearAdminPipelineLogOnLogout();
    setStoredToken(null);
    setUser(null);
  }, []);

  const setUserFromToken = useCallback(
    (token: string) => {
      setStoredToken(token);
      setLoading(true);
      loadUser();
    },
    [loadUser]
  );

  const refreshUser = useCallback(async () => {
    if (!api.getStoredToken()) return;
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      // keep current user on error
    }
  }, []);

  useEffect(() => {
    setAdminPipelineCapture(!!user && api.isAdminUser(user));
  }, [user]);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, loginWithGoogle, logout, setUserFromToken, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
