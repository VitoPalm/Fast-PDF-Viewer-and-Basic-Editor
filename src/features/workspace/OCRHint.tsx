import React from 'react';
import { Sparkles, X } from 'lucide-react';
import './OCRHint.css';

interface OCRHintProps {
  title?: string;
  description?: string;
  onOCR: () => void;
  onDismiss: () => void;
}

export const OCRHint: React.FC<OCRHintProps> = ({
  title = 'Scan Detected',
  description = 'This page appears to be a scan. Use OCR to make text searchable and selectable.',
  onOCR,
  onDismiss,
}) => {
  return (
    <div className="ocr-hint-container">
      <div className="ocr-hint-card glass">
        <div className="ocr-hint-icon">
          <Sparkles size={20} />
        </div>
        <div className="ocr-hint-content">
          <h4>{title}</h4>
          <p>{description}</p>
          <div className="ocr-hint-actions">
            <button className="btn btn-primary btn-sm" onClick={onOCR}>
              Run OCR
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </div>
        <button className="ocr-hint-close" onClick={onDismiss} aria-label="Dismiss OCR suggestion">
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
