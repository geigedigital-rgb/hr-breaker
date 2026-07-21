import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type AdminSandboxShellValue = {
  /** True when current route is Visual Sandbox. */
  isSandboxRoute: boolean;
  /** Page requests focus (Result / Both — studio visible). */
  studioFocus: boolean;
  setStudioFocus: (focus: boolean) => void;
  /** User forced sidebar open while in studio focus. */
  forceShowSidebar: boolean;
  setForceShowSidebar: (show: boolean) => void;
  /** Sidebar fully hidden. */
  sidebarHidden: boolean;
};

const AdminSandboxShellContext = createContext<AdminSandboxShellValue | null>(null);

export function AdminSandboxShellProvider({
  isSandboxRoute,
  children,
}: {
  isSandboxRoute: boolean;
  children: ReactNode;
}) {
  const [studioFocus, setStudioFocusState] = useState(false);
  const [forceShowSidebar, setForceShowSidebar] = useState(false);

  const setStudioFocus = useCallback((focus: boolean) => {
    setStudioFocusState(focus);
    if (!focus) setForceShowSidebar(false);
  }, []);

  const sidebarHidden = isSandboxRoute && studioFocus && !forceShowSidebar;

  const value = useMemo(
    () => ({
      isSandboxRoute,
      studioFocus,
      setStudioFocus,
      forceShowSidebar,
      setForceShowSidebar,
      sidebarHidden,
    }),
    [isSandboxRoute, studioFocus, setStudioFocus, forceShowSidebar, sidebarHidden],
  );

  return <AdminSandboxShellContext.Provider value={value}>{children}</AdminSandboxShellContext.Provider>;
}

export function useAdminSandboxShell(): AdminSandboxShellValue {
  const ctx = useContext(AdminSandboxShellContext);
  if (!ctx) {
    return {
      isSandboxRoute: false,
      studioFocus: false,
      setStudioFocus: () => {},
      forceShowSidebar: false,
      setForceShowSidebar: () => {},
      sidebarHidden: false,
    };
  }
  return ctx;
}
