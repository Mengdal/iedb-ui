/**
 * Format an ISO timestamp string using the browser's locale.
 * Returns the raw string if parsing fails, or '—' for nullish input.
 */
export function formatTime(ts: string | null | undefined, locale?: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return ts;
  }
}
