/**
 * Mirrors React's `escapeTextForBrowser` / attribute escaping so the injected
 * preview HTML string is byte-for-byte what Inkdrop's React tree would emit.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
