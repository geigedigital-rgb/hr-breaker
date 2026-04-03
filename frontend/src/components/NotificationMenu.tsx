import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Popover, Transition } from "@headlessui/react";
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

export function NotificationMenu() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Auto-generate notifications based on user state
  useEffect(() => {
    if (!user || user.id === "local") return;

    const generated: AppNotification[] = [];
    const dismissedStr = localStorage.getItem(`dismissed_notifications_${user.id}`);
    const dismissedIds: string[] = dismissedStr ? JSON.parse(dismissedStr) : [];
    const readStr = localStorage.getItem(`read_notifications_${user.id}`);
    const readIds: string[] = readStr ? JSON.parse(readStr) : [];

    // 1. Welcome Notification
    generated.push({
      id: "welcome",
      title: "Welcome to PitchCV!",
      message: "You have 10 ATS scans and 10 optimizations each month on Free. Add a resume and job to see your match score.",
      actionText: "Get started",
      actionUrl: "/optimize",
      type: "info",
      date: new Date(Date.now() - 1000 * 60 * 60 * 24),
      read: readIds.includes("welcome")
    });

    // 2. First Analysis Completed (Upsell)
    if (user.subscription?.plan === "free" && (user.subscription?.free_analyses_count ?? 0) >= 10) {
      generated.push({
        id: "first_analysis_upsell",
        title: "Great start!",
        message: "You've successfully analyzed your resume. Keep going! Let's optimize it so recruiters can't miss you.",
        actionText: "Unlock AI Optimization",
        actionUrl: "/upgrade",
        type: "upsell",
        date: new Date(Date.now() - 1000 * 60 * 60), 
        read: readIds.includes("first_analysis_upsell")
      });
    }

    // 3. Trial Reminder
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
          read: readIds.includes("trial_ending")
        });
      }
    }

    // Filter out dismissed and sort by date descending
    const activeNotifications = generated
      .filter(n => !dismissedIds.includes(n.id))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    setNotifications(activeNotifications);
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllAsRead = () => {
    if (!user) return;
    const readStr = localStorage.getItem(`read_notifications_${user.id}`);
    const readIds: string[] = readStr ? JSON.parse(readStr) : [];
    
    const newReadIds = [...new Set([...readIds, ...notifications.map(n => n.id)])];
    localStorage.setItem(`read_notifications_${user.id}`, JSON.stringify(newReadIds));
    
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const dismissNotification = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) return;
    
    const dismissedStr = localStorage.getItem(`dismissed_notifications_${user.id}`);
    const dismissedIds: string[] = dismissedStr ? JSON.parse(dismissedStr) : [];
    
    localStorage.setItem(`dismissed_notifications_${user.id}`, JSON.stringify([...dismissedIds, id]));
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // No icons — plain messages only
  
  return (
    <Popover className="relative" ref={popoverRef}>
      {({ open }) => (
        <>
          <Popover.Button
            className={`p-1.5 rounded-full border transition-colors outline-none relative ${
              open || unreadCount > 0
                ? "bg-[#EBEDF5] border-[#D1D5DB] text-[#181819]"
                : "bg-[#F5F6FA] border-[#EBEDF5] text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819]"
            }`}
            onClick={() => {
              if (!open && unreadCount > 0) {
                markAllAsRead();
              }
            }}
          >
            <BellIcon className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full"></span>
            )}
          </Popover.Button>

          <Transition
            show={open}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] border border-[#EBEDF5] z-50 overflow-hidden flex flex-col max-h-[80vh]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#EBEDF5] bg-gray-50/50">
                <h3 className="text-sm font-bold text-[#181819]">Notifications</h3>
                {notifications.length > 0 && (
                  <button 
                    onClick={(e) => {
                      e.preventDefault();
                      notifications.forEach(n => dismissNotification(n.id, e));
                    }}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-800 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              
              <div className="overflow-y-auto overscroll-contain">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center flex flex-col items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                      <BellIcon className="w-6 h-6 text-gray-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-900 mb-1">No notifications</p>
                    <p className="text-xs text-gray-500">You're all caught up!</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {notifications.map((n) => (
                      <div 
                        key={n.id} 
                        className={`rounded-xl border border-transparent px-3 py-3 transition-all duration-150 group relative ${!n.read ? "bg-[#f0f4ff]/50" : "bg-transparent"} hover:bg-gray-50 hover:border-gray-200/80`}
                      >
                        <button 
                          onClick={(e) => dismissNotification(n.id, e)}
                          className="absolute top-2.5 right-2.5 p-1 rounded-lg text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600 transition-all"
                          title="Dismiss"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <div className="pr-6 min-w-0">
                          <p className="text-sm font-semibold text-[#181819] mb-1 leading-snug">{n.title}</p>
                          <p className="text-xs text-[#4b5563] leading-relaxed mb-2.5">
                            {n.message}
                          </p>
                          {n.actionText && n.actionUrl && (
                            <Link 
                              to={n.actionUrl}
                              className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-semibold text-[#181819] bg-gray-100 border border-gray-200 hover:bg-gray-200/80 hover:border-gray-300 transition-colors"
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
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}
