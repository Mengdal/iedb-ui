import React, { useEffect, useRef, useState } from 'react';
import { 
  Activity, Settings, Database, Key, LayoutGrid, 
  Upload, TerminalSquare, LayoutDashboard, HelpCircle,
  ChevronDown, ChevronRight
} from 'lucide-react';
import './Sidebar.css';
import { CurrentView } from '../App';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  isOpen: boolean;
  currentView: CurrentView;
  onNavigate: (view: CurrentView) => void;
  onShowWelcome?: () => void;
}

type MenuConfig = {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
  view?: CurrentView;
  subItems?: { id: string, labelKey: string, view?: CurrentView, onClick?: () => void }[];
};

const Sidebar: React.FC<SidebarProps> = ({ isOpen, currentView, onNavigate, onShowWelcome }) => {
  const { servers, activeServer, selectServer } = useServers();
  const { t } = useTranslation();
  const [showServerMenu, setShowServerMenu] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [hoveredCollapsedMenu, setHoveredCollapsedMenu] = useState<string | null>(null);
  const [pinnedCollapsedMenu, setPinnedCollapsedMenu] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'query-data': true,
    'configure': false,
    'permission': true,
    'plugins': false,
    'help': true
  });

  const toggleSection = (id: string) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    if (currentView === 'plugins' || currentView === 'plugins-mqtt') {
      setExpandedSections(prev => ({ ...prev, plugins: true }));
    }
    if (currentView === 'tokens' || currentView === 'rbac') {
      setExpandedSections(prev => ({ ...prev, permission: true }));
    }
  }, [currentView]);

  useEffect(() => {
    if (!showServerMenu && !pinnedCollapsedMenu) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!sidebarRef.current) return;
      if (!sidebarRef.current.contains(event.target as Node)) {
        setShowServerMenu(false);
        setPinnedCollapsedMenu(null);
        setHoveredCollapsedMenu(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showServerMenu, pinnedCollapsedMenu]);

  const menuItems: MenuConfig[] = [
    { id: 'overview', labelKey: 'nav.systemOverview', icon: <Activity size={18} />, view: 'overview' },
    { 
      id: 'configure', 
      labelKey: 'nav.configure',
      icon: <Settings size={18} />,
      subItems: [
        { id: 'servers', labelKey: 'nav.servers', view: 'servers' },
        { id: 'integrations', labelKey: 'nav.integrations', view: 'integrations' }
      ]
    },
    { id: 'databases', labelKey: 'nav.databases', icon: <Database size={18} />, view: 'databases' },
    {
      id: 'permission',
      labelKey: 'nav.permission',
      icon: <Key size={18} />,
      subItems: [
        { id: 'tokens', labelKey: 'nav.tokens', view: 'tokens' },
        { id: 'rbac', labelKey: 'nav.rbac', view: 'rbac' }
      ]
    },
    {
      id: 'plugins',
      labelKey: 'nav.plugins',
      icon: <LayoutGrid size={18} />,
      subItems: [
        { id: 'plugins-cq', labelKey: 'nav.continuousQueries', view: 'plugins' },
        { id: 'plugins-mqtt', labelKey: 'nav.mqttSubscriptions', view: 'plugins-mqtt' }
      ]
    },
    { id: 'write-data', labelKey: 'nav.writeData', icon: <Upload size={18} />, view: 'write-data' },
    { 
      id: 'query-data', 
      labelKey: 'nav.queryData',
      icon: <TerminalSquare size={18} />,
      subItems: [
        { id: 'data-explorer', labelKey: 'nav.dataExplorer', view: 'data-explorer' }
      ]
    },
    { id: 'dashboards', labelKey: 'nav.dashboards', icon: <LayoutDashboard size={18} />, view: 'dashboards' },
    {
      id: 'help',
      labelKey: 'nav.help',
      icon: <HelpCircle size={18} />,
      subItems: [
        { id: 'tour', labelKey: 'nav.gettingStarted', onClick: onShowWelcome },
        { id: 'help-doc', labelKey: 'nav.documentation', view: 'help-doc' }
      ]
    },
  ];

  return (
    <aside ref={sidebarRef} className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      <nav className="nav-menu">
        {menuItems.map(item => {
          const hasSubItems = !!item.subItems?.length;
          const childActive = hasSubItems && item.subItems?.some(sub => sub.view === currentView);
          const shouldShowCollapsedSubmenu = !isOpen && hasSubItems && (pinnedCollapsedMenu === item.id || hoveredCollapsedMenu === item.id);

          return (
            <div
              key={item.id}
              className="nav-section"
              onMouseEnter={() => {
                if (!isOpen && hasSubItems && !pinnedCollapsedMenu) setHoveredCollapsedMenu(item.id);
              }}
              onMouseLeave={() => {
                if (!isOpen && hasSubItems && !pinnedCollapsedMenu) setHoveredCollapsedMenu(null);
              }}
            >
              <div
                className={`nav-item ${currentView === item.view || childActive ? 'active' : ''}`}
                onClick={() => {
                  if (item.subItems) {
                    if (isOpen) {
                      toggleSection(item.id);
                    } else {
                      setPinnedCollapsedMenu(prev => (prev === item.id ? null : item.id));
                      setHoveredCollapsedMenu(null);
                    }
                  } else if (item.view) {
                    setPinnedCollapsedMenu(null);
                    onNavigate(item.view);
                  }
                }}
              >
                <div className="nav-item-content">
                  <span className="nav-icon">{item.icon}</span>
                  {isOpen && <span className="nav-label">{t(item.labelKey)}</span>}
                </div>
                {isOpen && item.subItems && (
                  <span className="chevron">
                    {expandedSections[item.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                )}
              </div>

              {isOpen && item.subItems && expandedSections[item.id] && (
                <div className="sub-menu">
                  {item.subItems.map(sub => (
                    <div
                      key={sub.id}
                      className={`nav-sub-item ${sub.view && currentView === sub.view ? 'active' : ''}`}
                      onClick={() => {
                        if (sub.onClick) { sub.onClick(); }
                        else if (sub.view) { onNavigate(sub.view); }
                      }}
                    >
                      {t(sub.labelKey)}
                    </div>
                  ))}
                </div>
              )}

              {shouldShowCollapsedSubmenu && (
                <div
                  className="collapsed-sub-menu"
                  onMouseEnter={() => {
                    if (!isOpen && hasSubItems && !pinnedCollapsedMenu) setHoveredCollapsedMenu(item.id);
                  }}
                  onMouseLeave={() => {
                    if (!isOpen && hasSubItems && !pinnedCollapsedMenu) setHoveredCollapsedMenu(null);
                  }}
                >
                  {item.subItems!.map(sub => (
                    <div
                      key={sub.id}
                      className={`nav-sub-item ${sub.view && currentView === sub.view ? 'active' : ''}`}
                      onClick={() => {
                        if (sub.onClick) { sub.onClick(); }
                        else if (sub.view) { onNavigate(sub.view); }
                        setPinnedCollapsedMenu(null);
                        setHoveredCollapsedMenu(null);
                      }}
                    >
                      {t(sub.labelKey)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      
      <div className="sidebar-footer" style={{ position: 'relative' }}>
        {showServerMenu && (
          <div className={`server-dropdown-menu ${!isOpen ? 'collapsed' : ''}`}>
            {servers.map(s => (
              <div 
                key={s.id} 
                className={`server-dropdown-item ${activeServer?.id === s.id ? 'active' : ''}`}
                onClick={() => { selectServer(s.id); setShowServerMenu(false); }}
              >
                <Database size={14} /> {s.name}
              </div>
            ))}
            <div 
              className="server-dropdown-manage"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('servers');
                setShowServerMenu(false);
              }}
            >
              {t('nav.manageServers')}
            </div>
          </div>
        )}
        <div
          className="server-selector"
          title={t('common.activeServer')}
          onClick={() => setShowServerMenu(!showServerMenu)}
        >
          <Database size={16} />
          {isOpen && (
            <>
              <span>{activeServer ? activeServer.name : t('common.noServer')}</span>
              <ChevronDown size={14} className="ml-auto" />
            </>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
