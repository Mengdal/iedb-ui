import React, { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './ConfirmModal.css';

interface ConfirmModalProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  description,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onCancel}>
      <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {danger && <AlertTriangle size={18} className="confirm-modal-danger-icon" />}
            {title}
          </h3>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-modal-description">{description}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outlined" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger confirm-action-btn' : 'btn btn-primary confirm-action-btn'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="spin" size={16} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
