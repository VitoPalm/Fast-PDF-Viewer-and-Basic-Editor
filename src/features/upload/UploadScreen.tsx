import React, { useCallback, useState } from 'react';
import { UploadCloud, FileText } from 'lucide-react';
import clsx from 'clsx';
import './UploadScreen.css';

interface UploadScreenProps {
  onUpload: (files: File[]) => void;
}

export const UploadScreen: React.FC<UploadScreenProps> = ({ onUpload }) => {
  const [isDragging, setIsDragging] = useState(false);

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
        </label>
      </div>
    </div>
  );
};
