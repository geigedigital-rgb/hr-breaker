/** Tiny className joiner — prefer `.ds-*` tokens from index.css for surfaces/CTAs. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
