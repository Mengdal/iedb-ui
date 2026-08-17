/**
 * Format an ISO timestamp string using the browser's locale.
 * Returns the raw string if parsing fails, or '—' for nullish input.
 */
export function formatTime(ts: string | number | null | undefined, locale?: string): string {
  if (ts === null || ts === undefined || ts === '') return '—';
  try {
    return new Date(ts).toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'medium', // 精确到秒
    });
  } catch {
    return String(ts);
  }
}
