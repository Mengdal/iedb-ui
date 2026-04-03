import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './HelpDoc.css';

const YUQUE_HELP_DOC_URL =
  'https://lmgateway.yuque.com/org-wiki-lmgateway-tau91b/quu9zb/eoka2h331xgfw7k0';

export default function HelpDoc() {
  const openedRef = useRef(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    window.open(YUQUE_HELP_DOC_URL, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="help-doc-view">
      <div className="help-doc-fallback">
        <p>{t('views.helpDoc.opening')}</p>
        <a
          href={YUQUE_HELP_DOC_URL}
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
