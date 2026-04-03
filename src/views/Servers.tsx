import React, { useState } from 'react';
import { Plus, Check, Edit2, Trash2, Eye, EyeOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers, ServerConnection } from '../contexts/ServerContext';
import './Servers.css';

const Servers: React.FC = () => {
  const { t } = useTranslation();
  const { servers, selectedServerId, addServer, updateServer, deleteServer, selectServer } = useServers();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Omit<ServerConnection, 'id'>>({
    name: '',
    protocol: 'http://',
    host: '',
    token: ''
  });
  
  const [showToken, setShowToken] = useState(false);

  const openAddModal = () => {
    setEditingId(null);
    setFormData({ name: '', protocol: 'http://', host: '', token: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (server: ServerConnection) => {
    setEditingId(server.id);
    setFormData({
      name: server.name,
      protocol: server.protocol,
      host: server.host,
      token: server.token
    });
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateServer(editingId, formData);
    } else {
      addServer(formData);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="servers-container">
      <div className="page-header">
        <div>
          <h1 className="page-title-main">{t('views.servers.title')}</h1>
          <p className="page-subtitle">{t('views.servers.subtitle')}</p>
        </div>
      </div>

      <div className="servers-section">
        <div className="section-header">
          <div>
            <h2 className="section-title-large">{t('views.servers.sectionTitle')}</h2>
            <p className="section-desc">{t('views.servers.sectionDesc')}</p>
          </div>
          <button className="btn btn-primary" onClick={openAddModal}>
            <Plus size={16} /> {t('views.servers.addServer')}
          </button>
        </div>

        <div className="servers-grid">
          {servers.map((server) => {
            const isSelected = server.id === selectedServerId;
            return (
              <div className={`server-card ${isSelected ? 'selected' : ''}`} key={server.id}>
                <div className="server-info">
                  <h3 className="server-name">
                    {server.name}
                    {isSelected && <Check size={18} className="check-icon" />}
                  </h3>
                  <div className="server-url">
                    {server.protocol}{server.host}
                  </div>
                </div>
                
                <div className="server-actions">
                  <button 
                    className={`btn ${isSelected ? 'btn-filled-dark' : 'btn-outlined'}`}
                    onClick={() => selectServer(server.id)}
                  >
                    {isSelected ? t('views.servers.selected') : t('views.servers.select')}
                  </button>
                  <button className="icon-btn-bordered" onClick={() => openEditModal(server)}>
                    <Edit2 size={16} />
                  </button>
                  <button className="icon-btn-bordered btn-danger" onClick={() => deleteServer(server.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editingId ? t('views.servers.modalEditTitle') : t('views.servers.modalAddTitle')}</h3>
              <button className="icon-btn" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="server-form">
              <div className="form-group">
                <label>{t('views.servers.serverName')}</label>
                <input 
                  type="text" 
                  required 
                  placeholder={t('views.servers.serverNamePlaceholder')}
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>{t('views.servers.serverUrl')}</label>
                <div className="url-input-group">
                  <select 
                    value={formData.protocol}
                    onChange={e => setFormData({ ...formData, protocol: e.target.value as 'http://' | 'https://' })}
                  >
                    <option value="http://">http://</option>
                    <option value="https://">https://</option>
                  </select>
                  <input 
                    type="text" 
                    required 
                    placeholder={t('views.servers.hostPlaceholder')}
                    value={formData.host}
                    onChange={e => setFormData({ ...formData, host: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>{t('views.servers.token')}</label>
                <div className="token-input-group">
                  <input 
                    type={showToken ? "text" : "password"} 
                    required 
                    placeholder={t('views.servers.tokenPlaceholder')}
                    value={formData.token}
                    onChange={e => setFormData({ ...formData, token: e.target.value })}
                  />
                  <button type="button" className="toggle-visibility" onClick={() => setShowToken(!showToken)}>
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-outlined" onClick={() => setIsModalOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingId ? t('views.servers.submitUpdate') : t('views.servers.submitAdd')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Servers;
