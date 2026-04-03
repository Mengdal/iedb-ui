export type AppLanguage = 'zh-CN' | 'en-US';

export const SUPPORTED_LANGUAGES: AppLanguage[] = ['zh-CN', 'en-US'];

export const DEFAULT_LANGUAGE: AppLanguage = 'zh-CN';

export const I18N_STORAGE_KEY = 'iotedge-lang';

export function normalizeLanguage(input: string | null | undefined): AppLanguage | null {
  if (!input) return null;
  const v = input.trim();
  if (!v) return null;

  // Handle common browser patterns like "zh-CN", "zh_CN", "zh-Hans"
  if (v.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (v.toLowerCase().startsWith('en')) return 'en-US';
  return null;
}

export function getInitialLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(I18N_STORAGE_KEY);
    const normalized = normalizeLanguage(saved);
    if (normalized) return normalized;
  } catch {
    // ignore storage failure
  }

  try {
    const browser = typeof navigator !== 'undefined' ? navigator.language : undefined;
    const normalized = normalizeLanguage(browser);
    if (normalized) return normalized;
  } catch {
    // ignore navigator failure
  }

  return DEFAULT_LANGUAGE;
}

