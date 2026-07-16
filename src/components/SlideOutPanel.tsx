import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import './SlideOutPanel.css';

export interface SlideOutPanelProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number | string;
  bodyRef?: React.Ref<HTMLDivElement>;
}

function useSlideOutTransition(open: boolean, duration = 220) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);

  return { mounted, visible };
}

export const SlideOutPanel: React.FC<SlideOutPanelProps> = ({
  open,
  onClose,
  title,
  children,
  footer,
  width = 720,
  bodyRef,
}) => {
  const { mounted, visible } = useSlideOutTransition(open);

  useEffect(() => {
    if (!mounted) return;
    const contentArea = document.querySelector('.content-area') as HTMLElement | null;
    if (!contentArea) return;
    const originalOverflowY = contentArea.style.overflowY;
    contentArea.style.overflowY = 'hidden';
    return () => {
      contentArea.style.overflowY = originalOverflowY;
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      className={`slide-out-panel ${visible ? 'slide-out-panel-open' : ''}`}
      role="presentation"
      aria-hidden={!open}
    >
      <div className="slide-out-panel-backdrop" onClick={onClose} />
      <div
        className="slide-out-panel-panel"
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
      >
        <div className="slide-out-panel-header">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="slide-out-panel-body" ref={bodyRef}>
          {children}
        </div>
        {footer && <div className="slide-out-panel-footer">{footer}</div>}
      </div>
    </div>
  );
};

export default SlideOutPanel;
