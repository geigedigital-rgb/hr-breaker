/** Inline loader while a lazy route chunk is loading (keeps shell visible when used inside Layout). */
export default function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] w-full items-center justify-center py-16" aria-busy="true" aria-label="Loading">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-[#4578FC] border-t-transparent"
        aria-hidden
      />
    </div>
  );
}
