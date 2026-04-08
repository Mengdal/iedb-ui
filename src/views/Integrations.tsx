import React, { useRef, useState } from 'react';
import { BrainCircuit, Settings2, Eye, EyeOff, FileText, X, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './Integrations.css';

type AIProviderId =
  | 'custom'
  | 'lmstudio'
  | 'openai'
  | 'qwen'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'doubao'
  | 'tencent-hunyuan'
  | 'baidu-qianfan'
  | 'iflytek-spark';

const AI_PROVIDERS: Array<{
  id: AIProviderId;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
}> = [
  { id: 'custom', defaultBaseUrl: '', requiresApiKey: false },
  { id: 'lmstudio', defaultBaseUrl: 'http://localhost:1234/v1', requiresApiKey: false },
  { id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', requiresApiKey: true },

  // China-friendly / domestic vendors (OpenAI-compatible where possible)
  { id: 'qwen', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', requiresApiKey: true },
  { id: 'deepseek', defaultBaseUrl: 'https://api.deepseek.com/v1', requiresApiKey: true },
  { id: 'zhipu', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', requiresApiKey: true },
  { id: 'moonshot', defaultBaseUrl: 'https://api.moonshot.cn/v1', requiresApiKey: true },
  { id: 'doubao', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', requiresApiKey: true },
  { id: 'tencent-hunyuan', defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', requiresApiKey: true },
  { id: 'baidu-qianfan', defaultBaseUrl: 'https://qianfan.baidubce.com/v2', requiresApiKey: true },
  { id: 'iflytek-spark', defaultBaseUrl: 'https://spark-api-open.xf-yun.com/v1', requiresApiKey: true },
];

function providerConfig(id: string) {
  return AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];
}

function isAllowedInstructionsFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return true;
  const type = file.type.toLowerCase();
  return type === 'text/plain' || type === 'text/markdown' || type === 'text/x-markdown';
}

const Integrations: React.FC = () => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const [provider, setProvider] = useState(() => localStorage.getItem('iotedge-ai-provider') || 'lmstudio');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('iotedge-ai-apikey') || '');
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('iotedge-ai-baseurl') || 'http://localhost:1234/v1');
  const [instructions, setInstructions] = useState(() => localStorage.getItem('iotedge-ai-instructions') || '');
  const [isInstructionsExpanded, setIsInstructionsExpanded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const currentProvider = providerConfig(provider);
  const effectiveDefaultBaseUrl = currentProvider.defaultBaseUrl || t('views.integrations.baseUrlPlaceholder');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstructions, setModalInstructions] = useState('');
  const [activeTab, setActiveTab] = useState<'instructions' | 'template'>('instructions');
  const [instructionsUploadError, setInstructionsUploadError] = useState<string | null>(null);
  const instructionsFileInputRef = useRef<HTMLInputElement>(null);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    setProvider(newProvider);
    if (newProvider !== 'custom') {
      setBaseUrl(providerConfig(newProvider).defaultBaseUrl);
    }
  };

  const handleOpenModal = () => {
    setModalInstructions(instructions);
    setInstructionsUploadError(null);
    setIsModalOpen(true);
  };

  const handleSaveModal = () => {
    setInstructions(modalInstructions);
    localStorage.setItem('iotedge-ai-instructions', modalInstructions);
    setIsModalOpen(false);
  };

  const EXAMPLE_TEMPLATE = t('views.integrations.exampleTemplate');

  const handleUseTemplate = () => {
    setModalInstructions(EXAMPLE_TEMPLATE);
    setActiveTab('instructions');
  };

  const handleInstructionsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setInstructionsUploadError(null);
    if (!file) return;
    if (!isAllowedInstructionsFile(file)) {
      setInstructionsUploadError(t('views.integrations.uploadInvalidType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setModalInstructions(text);
    };
    reader.onerror = () => {
      setInstructionsUploadError(t('views.integrations.uploadReadFailed'));
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleSave = () => {
    localStorage.setItem('iotedge-ai-provider', provider);
    localStorage.setItem('iotedge-ai-apikey', apiKey);
    localStorage.setItem('iotedge-ai-baseurl', baseUrl);
    localStorage.setItem('iotedge-ai-instructions', instructions);
    setSaveStatus(t('views.integrations.saveStatusSaved'));
    setTimeout(() => setSaveStatus(''), 2000);
  };

  return (
    <div className="integrations-container">
      <div className="section-header">
        <div>
          <h2 className="section-title-large">{t('views.integrations.title')}</h2>
          <p className="section-desc">{t('views.integrations.subtitle')}</p>
        </div>
      </div>

      <div className="integrations-section">
        <div className="integration-card">
          <div className="integration-header">
            <BrainCircuit size={24} className="integration-icon" />
            <div className="integration-title-wrap">
              <h3>{t('views.integrations.aiConfigTitle')}</h3>
              <p>{t('views.integrations.aiConfigSubtitle')}</p>
            </div>
          </div>

          <div className="integration-form">
            <div className="form-group">
              <label>{t('views.integrations.aiProviderLabel')}</label>
              <select className="integration-select" value={provider} onChange={handleProviderChange}>
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(`views.integrations.providers.${p.id}`)}
                  </option>
                ))}
              </select>
              <span className="help-text">{t('views.integrations.aiProviderHelp')}</span>
            </div>

            <div className="form-group">
              <label>{t('views.integrations.baseUrlLabel')}</label>
              <input
                type="text"
                placeholder={effectiveDefaultBaseUrl}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="integration-input"
              />
              <span className="help-text">{t('views.integrations.baseUrlHelp', { url: effectiveDefaultBaseUrl })}</span>
            </div>

            <div className="form-group">
              <label>{t('views.integrations.apiKeyLabel')}</label>
              <div className="input-with-icon">
                <input
                  type={showApiKey ? "text" : "password"}
                  placeholder={t('views.integrations.apiKeyPlaceholder')}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="integration-input"
                />
                <button 
                  className="toggle-visibility" 
                  onClick={() => setShowApiKey(!showApiKey)}
                  type="button"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <span className="help-text">{t('views.integrations.apiKeyHelp')}</span>
            </div>

            <div className="form-group">
              <label>{t('views.integrations.customInstructionsLabel')}</label>
              <div className="instructions-row">
                <div className="instructions-textarea-wrapper">
                  <div 
                    className={`instructions-summary-box ${isInstructionsExpanded ? 'expanded' : ''}`}
                    onClick={() => instructions && setIsInstructionsExpanded(!isInstructionsExpanded)}
                    style={{ cursor: instructions ? 'pointer' : 'default' }}
                  >
                    <span>
                      {instructions 
                        ? t('views.integrations.customInstructionsSummaryWithCount', { count: instructions.length })
                        : t('views.integrations.customInstructionsSummaryEmpty')}
                    </span>
                    {instructions && (
                      <span className="chevron-icon">
                        {isInstructionsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    )}
                  </div>
                  {isInstructionsExpanded && instructions && (
                    <textarea 
                      className="integration-textarea instructions-preview" 
                      readOnly
                      value={instructions}
                    />
                  )}
                </div>
                <button 
                  className="btn-outlined btn-manage"
                  onClick={handleOpenModal}
                >
                  <FileText size={16} /> {t('views.integrations.customInstructionsManage')}
                </button>
              </div>
              <span className="help-text">{t('views.integrations.customInstructionsHelp')}</span>
            </div>

            <div className="integration-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button 
                className="btn-filled-light" 
                disabled={!apiKey && currentProvider.requiresApiKey}
                onClick={handleSave}
              >
                <Settings2 size={16} /> {t('views.integrations.saveAiConfigButton')}
              </button>
              {saveStatus && <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{saveStatus}</span>}
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="instructions-modal-content">
            <div className="modal-header">
              <div>
                <h3>{t('views.integrations.modalTitle')}</h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
                  {t('views.integrations.modalDescription')}
                </p>
              </div>
              <button className="icon-btn-bordered" onClick={() => setIsModalOpen(false)} style={{ border: 'none', background: 'transparent' }}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-tabs">
              <button 
                className={`tab-btn ${activeTab === 'instructions' ? 'active' : ''}`}
                onClick={() => setActiveTab('instructions')}
              >
                {t('views.integrations.modalTabInstructions')}
              </button>
              <button 
                className={`tab-btn ${activeTab === 'template' ? 'active' : ''}`}
                onClick={() => setActiveTab('template')}
              >
                {t('views.integrations.modalTabTemplate')}
              </button>
            </div>

            <div className="modal-body">
              {activeTab === 'instructions' ? (
                <textarea
                  className="modal-textarea"
                  placeholder={t('views.integrations.modalTextareaPlaceholder')}
                  value={modalInstructions}
                  onChange={(e) => setModalInstructions(e.target.value)}
                />
              ) : (
                <div className="template-preview">
                  <pre>
{EXAMPLE_TEMPLATE}
                  </pre>
                </div>
              )}
            </div>

            <div className="modal-tab-actions" style={{ padding: '0 24px 16px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
              {activeTab === 'instructions' ? (
                <>
                  <input
                    ref={instructionsFileInputRef}
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    style={{ display: 'none' }}
                    onChange={handleInstructionsFileChange}
                  />
                  <button className="btn-outlined btn-small" type="button" onClick={() => setModalInstructions('')}>
                    <FileText size={14} /> {t('views.integrations.clearButton')}
                  </button>
                  <button
                    type="button"
                    className="btn-outlined btn-small"
                    onClick={() => instructionsFileInputRef.current?.click()}
                  >
                    <Upload size={14} /> {t('views.integrations.uploadButton')}
                  </button>
                  {instructionsUploadError && (
                    <span style={{ color: '#ff6e6e', fontSize: '13px', width: '100%' }}>{instructionsUploadError}</span>
                  )}
                </>
              ) : (
                <button
                  className="btn-outlined btn-small"
                  onClick={handleUseTemplate}
                  style={{ color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}
                >
                  {t('views.integrations.useTemplateButton')}
                </button>
              )}
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-surface)' }}>
              <button className="btn-text" onClick={() => setIsModalOpen(false)}>{t('common.cancel')}</button>
              <button className="btn-filled-light" onClick={handleSaveModal}>
                {t('views.integrations.saveInstructionsButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Integrations;
