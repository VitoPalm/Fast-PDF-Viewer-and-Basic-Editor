import React, { useCallback, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import clsx from 'clsx';
import { getImportJobProgress, isImportJobBusy, isImportJobVisible, type ImportJob } from '../../context/importJob';
import './UploadScreen.css';

interface UploadScreenProps {
  onUpload: (files: File[]) => void;
  onCancelImport: () => void;
  importJob: ImportJob;
}

const formatUploadImportStatus = (job: ImportJob): string => {
  switch (job.phase) {
    case 'reading':
      return `Preparing ${job.filesTotal} file${job.filesTotal === 1 ? '' : 's'}...`;
    case 'loading':
      return job.currentFileName ? `Reading ${job.currentFileName}` : 'Reading PDF...';
    case 'instantiating':
      return `${job.pagesInstantiated}/${job.pagesTotal} pages ready`;
    case 'analyzing':
      return `Analyzing ${job.pagesAnalyzed}/${job.pagesTotal} pages`;
    case 'failed':
      return job.error ? `Import failed: ${job.error}` : 'Import failed';
    default:
      return 'Importing PDFs...';
  }
};

export const UploadScreen: React.FC<UploadScreenProps> = ({ onUpload, onCancelImport, importJob }) => {
  const [isDragging, setIsDragging] = useState(false);
  const showImportProgress = isImportJobVisible(importJob);
  const isImportRunning = isImportJobBusy(importJob);
  const importProgress = getImportJobProgress(importJob);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (!isImportRunning && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
      if (files.length > 0) {
        onUpload(files);
      }
    }
  }, [isImportRunning, onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (!isImportRunning && e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
      if (files.length > 0) {
        onUpload(files);
      }
    }
  }, [isImportRunning, onUpload]);

  return (
    <div className="app-container upload-screen">
      <div 
        className={clsx('glass animate-fade-in upload-panel', { 'active': isDragging })}
      >
        <div className="upload-brand">
          <h1>Antigravity PDF</h1>
          <p>Edit, merge, split, and repair searchable PDFs.</p>
        </div>

        <label 
          className={clsx('dropzone', { 'active': isDragging })}
          data-disabled={isImportRunning ? 'true' : undefined}
          aria-disabled={isImportRunning}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input 
            type="file" 
            multiple 
            accept="application/pdf" 
            className="dropzone-input"
            aria-label="Select PDF files"
            disabled={isImportRunning}
            onChange={handleChange}
          />
          <UploadCloud className="dropzone-icon" />
          <h3 style={{ marginBottom: '8px' }}>{isImportRunning ? 'Import in progress' : 'Drag & drop PDFs here'}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
            {isImportRunning ? 'You can add more PDFs after this import finishes.' : 'or click to browse files'}
          </p>
          <span className="btn btn-primary">
            <FileText size={18} /> Select PDF Files
          </span>
        </label>
        {showImportProgress && (
          <div className="upload-progress" data-testid="upload-import-progress" role="status" aria-live="polite">
            <div className="upload-progress-label">
              <span>{formatUploadImportStatus(importJob)}</span>
              <span>{importProgress}%</span>
            </div>
            <div
              className="upload-progress-bar"
              role="progressbar"
              aria-label="PDF import progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={importProgress}
            >
              <div style={{ width: `${importProgress}%` }} />
            </div>
            {isImportRunning && (
              <button
                type="button"
                className="upload-progress-cancel"
                onClick={onCancelImport}
                aria-label="Cancel import"
              >
                <X size={14} />
                Cancel import
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
