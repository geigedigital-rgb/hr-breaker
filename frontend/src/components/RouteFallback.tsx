/** Inline loader while a lazy route chunk is loading (keeps shell visible when used inside Layout). */
const ROUTE_FALLBACK_HEIGHT =
  "min-h-0 h-[calc(100dvh-var(--app-header-height,3.5rem)-2rem)] max-h-[calc(100dvh-var(--app-header-height,3.5rem)-2rem)]";

export default function RouteFallback() {
  return (
    <div
      className={`flex w-full items-center justify-center overflow-y-auto ${ROUTE_FALLBACK_HEIGHT}`}
      aria-busy="true"
      aria-label="Loading"
    >
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent"
        aria-hidden
      />
    </div>
  );
}
