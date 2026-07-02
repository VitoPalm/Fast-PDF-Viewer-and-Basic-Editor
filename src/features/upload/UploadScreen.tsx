import React, { useCallback, useState } from 'react';
import { UploadCloud, FileText } from 'lucide-react';
import clsx from 'clsx';
import { getImportJobProgress, isImportJobVisible, type ImportJob } from '../../context/importJob';
import './UploadScreen.css';

interface UploadScreenProps {
  onUpload: (files: File[]) => void;
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

export const UploadScreen: React.FC<UploadScreenProps> = ({ onUpload, importJob }) => {
  const [isDragging, setIsDragging] = useState(false);
  const showImportProgress = isImportJobVisible(importJob);
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
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
      if (files.length > 0) {
        onUpload(files);
      }
    }
  }, [onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
      if (files.length > 0) {
        onUpload(files);
      }
    }
  }, [onUpload]);

  return (
    <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center', background: 'var(--bg-gradient)' }}>
      <div 
        className={clsx('glass animate-fade-in', { 'active': isDragging })}
        style={{ 
          padding: '40px', 
          borderRadius: '24px', 
          width: '100%', 
          maxWidth: '600px',
          textAlign: 'center'
        }}
      >
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '8px', background: 'linear-gradient(to right, #fff, #a0a4ab)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Cool PDF Editor
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Edit, merge, split, and reorder your PDFs with a premium aesthetic.</p>
        </div>

        <label 
          className={clsx('dropzone', { 'active': isDragging })}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input 
            type="file" 
            multiple 
            accept="application/pdf" 
            style={{ display: 'none' }} 
            onChange={handleChange}
          />
          <UploadCloud className="dropzone-icon" />
          <h3 style={{ marginBottom: '8px' }}>Drag & drop PDFs here</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>or click to browse files</p>
          <div className="btn btn-primary">
            <FileText size={18} /> Select PDF Files
          </div>
          {showImportProgress && (
            <div className="upload-progress" data-testid="upload-import-progress">
              <div className="upload-progress-label">
                <span>{formatUploadImportStatus(importJob)}</span>
                <span>{importProgress}%</span>
              </div>
              <div className="upload-progress-bar" aria-hidden="true">
                <div style={{ width: `${importProgress}%` }} />
              </div>
            </div>
          )}
        </label>
      </div>
    </div>
  );
};
