import React from 'react';
import './OCRProcessingOverlay.css';

interface OCRProcessingOverlayProps {
  progress: number;
  status: string;
}

export const OCRProcessingOverlay: React.FC<OCRProcessingOverlayProps> = ({ progress, status }) => {
  return (
    <div className="ocr-overlay">
      <div className="scanning-line"></div>
      <div className="ocr-status-card glass">
        <div className="ocr-spinner"></div>
        <div className="ocr-info">
          <h3>OCR Processing</h3>
          <p>{status}</p>
          <div className="ocr-progress-container">
            <div
              className="ocr-progress-bar"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <span className="ocr-percentage">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
};
