import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './HelpDoc.css';

const DOCS_URL = 'http://docs.lmgateway.com/';

export default function HelpDoc() {
  const openedRef = useRef(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    window.open(DOCS_URL, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="help-doc-view">
      <div className="help-doc-fallback">
        <p>{t('views.helpDoc.opening')}</p>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="help-doc-link"
        >
          {t('views.helpDoc.openLink')}
        </a>
      </div>
    </div>
  );
}
