import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Popover, Portal, Transition } from "@headlessui/react";
import { BellIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../contexts/AuthContext";

type AppNotification = {
  id: string;
  title: string;
  message: string;
  actionText?: string;
  actionUrl?: string;
  type: "success" | "info" | "warning" | "upsell";
  date: Date;
  read: boolean;
};

type NotificationMenuProps = {
  /** Sidebar: portal panel into main content so it isn’t clipped. */
  variant?: "default" | "sidebar";
};

export function NotificationMenu({ variant = "default" }: NotificationMenuProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const updatePanelPosition = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(384, window.innerWidth - 16);
    let left = r.right + 8;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, r.left - width - 8);
    }
    const approxH = Math.min(320, window.innerHeight * 0.8);
    let top = r.bottom + 8;
    if (top + approxH > window.innerHeight - 8) {
      top = Math.max(8, r.top - approxH - 8);
    }
    setPanelStyle({
      position: "fixed",
      top,
      left,
      width,
      zIndex: 60,
    });
  }, []);

  useEffect(() => {
    if (variant !== "sidebar") return;
    const onMove = () => {
      if (buttonRef.current?.getAttribute("aria-expanded") === "true") {
        updatePanelPosition();
      }
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [variant, updatePanelPosition]);

  useEffect(() => {
    if (!user || user.id === "local") return;

    const generated: AppNotification[] = [];
    const dismissedStr = localStorage.getItem(`dismissed_notifications_${user.id}`);
    const dismissedIds: string[] = dismissedStr ? JSON.parse(dismissedStr) : [];
    const readStr = localStorage.getItem(`read_notifications_${user.id}`);
    const readIds: string[] = readStr ? JSON.parse(readStr) : [];

    generated.push({
      id: "welcome",
      title: "Welcome to PitchCV!",
      message: "You have 10 ATS scans and 10 optimizations each month on Free. Add a resume and job to see your match score.",
      actionText: "Get started",
      actionUrl: "/optimize",
      type: "info",
      date: new Date(Date.now() - 1000 * 60 * 60 * 24),
      read: readIds.includes("welcome"),
    });

    if (user.subscription?.plan === "free" && (user.subscription?.free_analyses_count ?? 0) >= 10) {
      generated.push({
        id: "first_analysis_upsell",
        title: "Great start!",
        message: "You've successfully analyzed your resume. Keep going! Let's optimize it so recruiters can't miss you.",
        actionText: "Unlock AI Optimization",
        actionUrl: "/upgrade",
        type: "upsell",
        date: new Date(Date.now() - 1000 * 60 * 60),
        read: readIds.includes("first_analysis_upsell"),
      });
    }

    if (user.subscription?.plan === "trial" && user.subscription.current_period_end) {
      const endDate = new Date(user.subscription.current_period_end);
      const daysLeft = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 3 && daysLeft > 0) {
        generated.push({
          id: "trial_ending",
          title: "Trial ending soon",
          message: `Your trial ends in ${daysLeft} days. Make sure to download all your optimized resumes!`,
          type: "warning",
          date: new Date(),
          read: readIds.includes("trial_ending"),
        });
      }
    }

    setNotifications(
      generated
        .filter((n) => !dismissedIds.includes(n.id))
        .sort((a, b) => b.date.getTime() - a.date.getTime()),
    );
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = () => {
    if (!user) return;
    const readStr = localStorage.getItem(`read_notifications_${user.id}`);
    const readIds: string[] = readStr ? JSON.parse(readStr) : [];
    const newReadIds = [...new Set([...readIds, ...notifications.map((n) => n.id)])];
    localStorage.setItem(`read_notifications_${user.id}`, JSON.stringify(newReadIds));
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const dismissNotification = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) return;
    const dismissedStr = localStorage.getItem(`dismissed_notifications_${user.id}`);
    const dismissedIds: string[] = dismissedStr ? JSON.parse(dismissedStr) : [];
    localStorage.setItem(`dismissed_notifications_${user.id}`, JSON.stringify([...dismissedIds, id]));
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const panelClass =
    "bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] border border-[var(--border)] z-50 overflow-hidden flex flex-col max-h-[80vh]";

  const panelBody = (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-subtle)]/50">
        <h3 className="text-sm font-bold text-[var(--text)]">Notifications</h3>
        {notifications.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              notifications.forEach((n) => dismissNotification(n.id, e));
            }}
            className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="overflow-y-auto overscroll-contain">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-[var(--accent-soft)] flex items-center justify-center mb-3">
              <BellIcon className="w-6 h-6 text-[var(--text-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--text)] mb-1">No notifications</p>
            <p className="text-xs text-[var(--text-muted)]">You're all caught up!</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`rounded-xl border border-transparent px-3 py-3 transition-all duration-150 group relative ${!n.read ? "bg-[var(--accent-soft)]/50" : "bg-transparent"} hover:bg-[var(--bg-subtle)] hover:border-[var(--border)]`}
              >
                <button
                  type="button"
                  onClick={(e) => dismissNotification(n.id, e)}
                  className="absolute top-2.5 right-2.5 p-1 rounded-lg text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--accent-soft)] hover:text-[var(--text)] transition-all"
                  title="Dismiss"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="pr-6 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)] mb-1 leading-snug">{n.title}</p>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-2.5">{n.message}</p>
                  {n.actionText && n.actionUrl && (
                    <Link
                      to={n.actionUrl}
                      className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text)] bg-[var(--bg-subtle)] border border-[var(--border)] hover:bg-[var(--accent-soft)] transition-colors"
                    >
                      {n.actionText}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <Popover className="relative shrink-0" ref={popoverRef}>
      {({ open }) => {
        const button = (
          <Popover.Button
            ref={buttonRef}
            className={`p-1.5 rounded-full border transition-colors outline-none relative ${
              open || unreadCount > 0
                ? "bg-[var(--accent-soft)] border-[var(--border)] text-[var(--text)]"
                : "bg-[var(--bg-subtle)] border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
            }`}
            onClick={() => {
              if (variant === "sidebar") updatePanelPosition();
              if (!open && unreadCount > 0) markAllAsRead();
            }}
          >
            <BellIcon className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full" />
            )}
          </Popover.Button>
        );

        const panel = (
          <Transition
            show={open}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel
              className={
                variant === "sidebar"
                  ? panelClass
                  : `absolute right-0 top-full mt-2 w-80 sm:w-96 ${panelClass}`
              }
              style={variant === "sidebar" ? panelStyle : undefined}
            >
              {panelBody}
            </Popover.Panel>
          </Transition>
        );

        return (
          <>
            {button}
            {variant === "sidebar" ? <Portal>{panel}</Portal> : panel}
          </>
        );
      }}
    </Popover>
  );
}
