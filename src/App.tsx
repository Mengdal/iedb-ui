import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServers } from './contexts/ServerContext';
import { Database, Plus } from 'lucide-react';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import WelcomeModal from './components/WelcomeModal';
import SystemOverview from './views/SystemOverview';
import DataExplorer from './views/DataExplorer';
import Servers from './views/Servers';
import Integrations from './views/Integrations';
import Databases from './views/Databases';
import WriteData from './views/WriteData';
import HelpDoc from './views/HelpDoc';
import Tokens from './views/Tokens';
import Rbac from './views/Rbac';
import Plugins from './views/Plugins';
import PluginsMqtt from './views/PluginsMqtt';
import './App.css';

export type CurrentView =
  | 'overview'
  | 'data-explorer'
  | 'write-data'
  | 'servers'
  | 'databases'
  | 'tokens'
  | 'rbac'
  | 'plugins'
  | 'plugins-mqtt'
  | 'commands'
  | 'dashboards'
  | 'integrations'
  | 'help-doc';

const VIEW_STORAGE_KEY = 'iotedge-current-view';

function App() {
  const { t, i18n } = useTranslation();
  const { servers } = useServers();

  const [currentView, setCurrentView] = useState<CurrentView>(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY) as CurrentView | null;
      if (!stored && servers.length === 0) return 'servers';
      return stored || 'overview';
    } catch {
      if (servers.length === 0) return 'servers';
      return 'overview';
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('iotedge-sidebar-open');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      return localStorage.getItem('iotedge-welcome-seen') !== 'true';
    } catch {
      return true;
    }
  });

  const handleCloseWelcome = () => {
    setShowWelcome(false);
    try {
      localStorage.setItem('iotedge-welcome-seen', 'true');
    } catch {
      // ignore
    }
  };

  const renderView = () => {
    const hasNoServers = servers.length === 0;
    const isConfigRoute = currentView === 'servers' || currentView === 'integrations' || currentView === 'help-doc';

    if (hasNoServers && !isConfigRoute) {
      return (
        <div style={{ padding: '60px 20px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '40px' }}>
            <Database size={48} color="#3b82f6" style={{ marginBottom: 16 }} />
            <h2 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 12px 0' }}>{t('views.databases.noServerTitle', 'No Server Connected')}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: 1.5, marginBottom: '24px' }}>
              {t('views.databases.noServerHint', 'Please select an active server from the sidebar.')}
            </p>
            <button className="btn btn-primary" onClick={() => setCurrentView('servers')}>
              <Plus size={16} />
              {t('nav.configure')} {t('nav.servers')}
            </button>
          </div>
        </div>
      );
    }

    switch (currentView) {
      case 'overview': return <SystemOverview />;
      case 'data-explorer': return <DataExplorer />;
      case 'servers': return <Servers />;
      case 'integrations': return <Integrations />;
      case 'databases': return <Databases />;
      case 'write-data': return <WriteData />;
      case 'help-doc': return <HelpDoc />;
      case 'tokens': return <Tokens />;
      case 'rbac': return <Rbac />;
      case 'plugins': return <Plugins />;
      case 'plugins-mqtt': return <PluginsMqtt />;
      default:
        return (
          <div className="placeholder-view">
            <h2>{currentView.replace('-', ' ').toUpperCase()}</h2>
            <p>{t('views.placeholder.underConstruction')}</p>
          </div>
        );

    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, currentView);
    } catch {
      // ignore storage failure
    }
  }, [currentView]);

  useEffect(() => {
    try {
      localStorage.setItem('iotedge-sidebar-open', String(sidebarOpen));
    } catch {
      // ignore storage failure
    }
  }, [sidebarOpen]);

  const getPageTitle = () => {
    switch (currentView) {
      case 'overview': return t('views.overview.title');
      case 'data-explorer':
        return t('views.dataExplorer.title', {
          ns: 'translation',
          defaultValue: i18n.language.toLowerCase().startsWith('zh') ? '数据浏览器' : 'Data Explorer'
        });
      case 'write-data': return t('views.writeData.title');
      case 'servers': return t('views.servers.title');
      case 'databases': return t('views.databases.title');
      case 'tokens': return t('views.tokens.title');
      case 'rbac': return t('views.rbac.title', { defaultValue: i18n.language.toLowerCase().startsWith('zh') ? 'RBAC 管理' : 'RBAC' });
      case 'plugins': return t('views.plugins.title');
      case 'plugins-mqtt': return t('views.pluginsMqtt.title');
      case 'dashboards': return t('views.dashboards.title');
      case 'integrations': return t('views.integrations.title');
      case 'help-doc': return t('views.helpDoc.title');
      default: return t('views.placeholder.configuration');
    }
  };

  return (
    <div className="app-container">
      <TopNav
        toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        pageTitle={getPageTitle()}
      />
      <div className="main-layout">
        <Sidebar
          isOpen={sidebarOpen}
          currentView={currentView}
          onNavigate={setCurrentView}
          onShowWelcome={() => setShowWelcome(true)}
        />
        <main className="content-area">
          {renderView()}
        </main>
      </div>

      {showWelcome && <WelcomeModal onClose={handleCloseWelcome} />}
    </div>
  );
}

export default App;
