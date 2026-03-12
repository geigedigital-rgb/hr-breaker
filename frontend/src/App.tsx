import { Component, type ReactNode } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { isAdminUser } from "./api";
import Layout from "./Layout";
import AdminLayout from "./AdminLayout";
import Home from "./pages/Home";
import Optimize from "./pages/Optimize";
import History from "./pages/History";
import Progress from "./pages/Progress";
import Vacancies from "./pages/Vacancies";
import Settings from "./pages/Settings";
import Upgrade from "./pages/Upgrade";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminApp from "./pages/admin/AdminApp";
import { t } from "./i18n";

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
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="optimize" element={<Optimize />} />
              <Route path="history" element={<History />} />
              <Route path="progress" element={<Progress />} />
              <Route path="vacancies" element={<Vacancies />} />
              <Route path="settings" element={<Settings />} />
              <Route path="upgrade" element={<Upgrade />} />
            </Route>
            <Route path="/admin" element={<RequireAuth><RequireAdmin><AdminLayout /></RequireAdmin></RequireAuth>}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="app" element={<AdminApp />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
