import { useState, useRef, useEffect, type ReactNode } from "react";

type TooltipProps = {
  title: string;
  description?: string;
  children: ReactNode;
  side?: "top" | "bottom";
};

const HOVER_DELAY_MS = 400;

export function Tooltip({ title, description, children, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    showTimer.current = setTimeout(() => setVisible(true), HOVER_DELAY_MS);
  };
  const hide = () => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setVisible(false);
  };

  useEffect(() => () => { if (showTimer.current) clearTimeout(showTimer.current); }, []);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={`absolute left-1/2 z-50 -translate-x-1/2 max-w-[280px] rounded-xl border border-[#EBEDF5] bg-white px-4 py-3 text-left shadow-lg shadow-black/8 whitespace-normal ${
            side === "top" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <p className="text-sm font-semibold text-[#181819]">{title}</p>
          {description && (
            <p className="mt-1 text-xs text-[var(--text-muted)] leading-snug">{description}</p>
          )}
        </div>
      )}
    </div>
  );
}
