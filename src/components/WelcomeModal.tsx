import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, TerminalSquare, RadioReceiver, LineChart, X, ArrowRight } from 'lucide-react';
import './WelcomeModal.css';

interface WelcomeModalProps {
  onClose: () => void;
}

export default function WelcomeModal({ onClose }: WelcomeModalProps) {
  const { t } = useTranslation();

  // 屏蔽外层滚动
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const features = [
    {
      id: 'connections',
      icon: <Server size={20} />,
      titlePath: 'views.welcomeModal.features.connections.title',
      descPath: 'views.welcomeModal.features.connections.desc',
      color: '#3b82f6',
      bg: 'rgba(59, 130, 246, 0.15)'
    },
    {
      id: 'query',
      icon: <TerminalSquare size={20} />,
      titlePath: 'views.welcomeModal.features.query.title',
      descPath: 'views.welcomeModal.features.query.desc',
      color: '#8b5cf6',
      bg: 'rgba(139, 92, 246, 0.15)'
    },
    {
      id: 'ingest',
      icon: <RadioReceiver size={20} />,
      titlePath: 'views.welcomeModal.features.ingest.title',
      descPath: 'views.welcomeModal.features.ingest.desc',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.15)'
    },
    {
      id: 'monitor',
      icon: <LineChart size={20} />,
      titlePath: 'views.welcomeModal.features.monitor.title',
      descPath: 'views.welcomeModal.features.monitor.desc',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.15)'
    }
  ];

  return (
    <div className="welcome-modal-overlay" onClick={onClose}>
      <div className="welcome-modal-content" onClick={(e) => e.stopPropagation()}>
        <button 
          className="welcome-close-icon" 
          onClick={onClose}
          aria-label={t('views.welcomeModal.closeBtn')}
          title={t('views.welcomeModal.closeBtn')}
        >
          <X size={20} />
        </button>

        <div className="welcome-modal-header">
          <h2 className="welcome-title">{t('views.welcomeModal.title')}</h2>
          <p className="welcome-subtitle">{t('views.welcomeModal.subtitle')}</p>
        </div>

        <div className="welcome-body">
          {features.map((feature) => (
            <div key={feature.id} className="welcome-feature-card">
              <div className="welcome-icon-box" style={{ color: feature.color, background: feature.bg }}>
                {feature.icon}
              </div>
              <div>
                <h3 className="feature-title">{t(feature.titlePath)}</h3>
                <p className="feature-desc">{t(feature.descPath)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="welcome-modal-footer">
          <button className="welcome-start-btn" onClick={onClose}>
            {t('views.welcomeModal.startBtn')}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
