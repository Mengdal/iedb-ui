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
          <img src="/img/logo.png" alt="IotEdge DB Logo" className="brand-logo" />
          <span className="page-title">{pageTitle}</span>
        </div>
      </div>

      <div className="nav-right">
        <span className="version">{import.meta.env.VITE_APP_VERSION || 'dev'}</span>
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
