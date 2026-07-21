/** Shorten a long filename for UI while keeping extension visible. */
export function displayFilename(name: string | null | undefined, max = 36): string {
  const base = (name || "").trim() || "Resume";
  if (base.length <= max) return base;
  const extMatch = base.match(/(\.[a-z0-9]{1,8})$/i);
  const ext = extMatch?.[1] ?? "";
  const stem = ext ? base.slice(0, -ext.length) : base;
  const keep = Math.max(10, max - ext.length - 1);
  return `${stem.slice(0, keep)}…${ext}`;
}

/** Prefer original upload name; never show internal uploaded_* keys in UI. */
export function resumeLabel(
  originalFilename: string | null | undefined,
  storedFilename: string | null | undefined,
  fallback = "Resume",
): string {
  const original = (originalFilename || "").trim();
  if (original) return original;
  const stored = (storedFilename || "").trim();
  if (!stored) return fallback;
  if (stored.toLowerCase().startsWith("uploaded_")) return fallback;
  return stored;
}
