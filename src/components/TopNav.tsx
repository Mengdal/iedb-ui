import React from 'react';
import { Menu, HelpCircle } from 'lucide-react';
import './TopNav.css';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../contexts/LanguageContext';
import { AppLanguage } from '../i18n/languages';

interface TopNavProps {
  toggleSidebar: () => void;
  pageTitle: string;
}

const TopNav: React.FC<TopNavProps> = ({ toggleSidebar, pageTitle }) => {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();

  return (
    <header className="top-nav">
      <div className="nav-left">
        <button className="icon-btn hamburger" onClick={toggleSidebar}>
          <Menu size={20} />
        </button>
        <div className="brand">
          <svg className="brand-logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 2L2 9.5V22.5L16 30L30 22.5V9.5L16 2Z" fill="var(--accent-primary)"/>
            <path d="M16 6.5L6.5 11.5V19.5L16 24.5L25.5 19.5V11.5L16 6.5Z" fill="#fff"/>
          </svg>
          <span className="brand-name">IotEdge DB</span>
          <span className="page-title">{pageTitle}</span>
        </div>
      </div>
      
      <div className="nav-right">
        <span className="version">v1.6.2</span>
        <select
          className="lang-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as AppLanguage)}
          aria-label={t('common.language')}
        >
          <option value="zh-CN">{t('languages.zh-CN')}</option>
          <option value="en-US">{t('languages.en-US')}</option>
        </select>
        <a
          className="icon-btn"
          href="https://www.lmgateway.com/contact.html"
          target="_blank"
          rel="noreferrer"
          title="联系我们"
          aria-label="联系我们"
        >
          <HelpCircle size={20} />
        </a>
      </div>
    </header>
  );
};

export default TopNav;
