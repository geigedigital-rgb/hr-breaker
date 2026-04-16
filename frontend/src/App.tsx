import { Component, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { isAdminUser } from "./api";
import Layout from "./Layout";
import AdminLayout from "./AdminLayout";
import RouteFallback from "./components/RouteFallback";
import { t } from "./i18n";

const Home = lazy(() => import("./pages/Home"));
const ImproveResume = lazy(() => import("./pages/ImproveResume"));
const Optimize = lazy(() => import("./pages/Optimize"));
const History = lazy(() => import("./pages/History"));
const Progress = lazy(() => import("./pages/Progress"));
const Vacancies = lazy(() => import("./pages/Vacancies"));
const Settings = lazy(() => import("./pages/Settings"));
const Upgrade = lazy(() => import("./pages/Upgrade"));
const DownloadCheckout = lazy(() => import("./pages/DownloadCheckout"));
const Partner = lazy(() => import("./pages/Partner"));
const Login = lazy(() => import("./pages/Login"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const SignupSuccess = lazy(() => import("./pages/SignupSuccess"));
const EmailUnsubscribed = lazy(() => import("./pages/EmailUnsubscribed"));
const OptimizeSnapshot = lazy(() => import("./pages/OptimizeSnapshot"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminUserDetail = lazy(() => import("./pages/admin/AdminUserDetail"));
const AdminApp = lazy(() => import("./pages/admin/AdminApp"));
const AdminConfig = lazy(() => import("./pages/admin/AdminConfig"));
const AdminActivity = lazy(() => import("./pages/admin/AdminActivity"));
const AdminUsage = lazy(() => import("./pages/admin/AdminUsage"));
const AdminReferrals = lazy(() => import("./pages/admin/AdminReferrals"));
const AdminReviews = lazy(() => import("./pages/admin/AdminReviews"));
const AdminVisualTest = lazy(() => import("./pages/admin/AdminVisualTest"));
const AdminTemplatesLab = lazy(() => import("./pages/admin/AdminTemplatesLab"));
const AdminEmailGroups = lazy(() => import("./pages/admin/AdminEmailGroups"));
const AdminEmailTemplates = lazy(() => import("./pages/admin/AdminEmailTemplates"));
const AdminEmailSend = lazy(() => import("./pages/admin/AdminEmailSend"));

function LazyShell({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F3F9]">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequirePartnerAccess({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F3F9]">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!user.partner_program_access) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F3F9]">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent" aria-hidden />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdminUser(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui", color: "#181819" }}>
          <h1>{t("app.errorTitle")}</h1>
          <p>{t("app.errorHint")}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <LazyShell>
                  <Login />
                </LazyShell>
              }
            />
            <Route
              path="/signup-success"
              element={
                <LazyShell>
                  <SignupSuccess />
                </LazyShell>
              }
            />
            <Route
              path="/auth/callback"
              element={
                <LazyShell>
                  <AuthCallback />
                </LazyShell>
              }
            />
            <Route
              path="/email/unsubscribed"
              element={
                <LazyShell>
                  <EmailUnsubscribed />
                </LazyShell>
              }
            />
            <Route
              path="/optimize/snapshot"
              element={
                <LazyShell>
                  <OptimizeSnapshot />
                </LazyShell>
              }
            />
            <Route
              path="/checkout/download-resume"
              element={
                <RequireAuth>
                  <LazyShell>
                    <DownloadCheckout />
                  </LazyShell>
                </RequireAuth>
              }
            />
            <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="improve" element={<ImproveResume />} />
              <Route path="optimize" element={<Optimize />} />
              <Route path="history" element={<History />} />
              <Route path="progress" element={<Progress />} />
              <Route path="vacancies" element={<Vacancies />} />
              <Route path="settings" element={<Settings />} />
              <Route path="upgrade" element={<Upgrade />} />
              <Route
                path="partner"
                element={
                  <RequirePartnerAccess>
                    <Partner />
                  </RequirePartnerAccess>
                }
              />
            </Route>
            <Route path="/admin" element={<RequireAuth><RequireAdmin><AdminLayout /></RequireAdmin></RequireAuth>}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:userId" element={<AdminUserDetail />} />
              <Route path="activity" element={<AdminActivity />} />
              <Route path="usage" element={<AdminUsage />} />
              <Route path="referrals" element={<AdminReferrals />} />
              <Route path="reviews" element={<AdminReviews />} />
              <Route path="config" element={<AdminConfig />} />
              <Route path="app" element={<AdminApp />} />
              <Route path="templates-lab" element={<AdminTemplatesLab />} />
              <Route path="visual" element={<AdminVisualTest />} />
              <Route path="email" element={<Navigate to="/admin/email/send" replace />} />
              <Route path="email/send" element={<AdminEmailSend />} />
              <Route path="email/groups" element={<AdminEmailGroups />} />
              <Route path="email/templates" element={<AdminEmailTemplates />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
