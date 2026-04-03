import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import i18n from '../i18n/i18n';
import { AppLanguage, DEFAULT_LANGUAGE, getInitialLanguage, I18N_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../i18n/languages';

type LanguageContextType = {
  language: AppLanguage;
  setLanguage: (lng: AppLanguage) => void;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    try {
      const initial = getInitialLanguage();
      if (SUPPORTED_LANGUAGES.includes(initial)) return initial;
    } catch {
      // ignore
    }
    return DEFAULT_LANGUAGE;
  });

  useEffect(() => {
    // Sync html lang attribute for better typography/accessibility.
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    // Keep i18next in sync with the selected language.
    if (i18n.language !== language) {
      i18n.changeLanguage(language).catch(() => {});
    }

    try {
      localStorage.setItem(I18N_STORAGE_KEY, language);
    } catch {
      // ignore storage failure
    }
  }, [language]);

  const setLanguage = (lng: AppLanguage) => {
    setLanguageState(lng);
  };

  const value = useMemo(() => ({ language, setLanguage }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

