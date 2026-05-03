import { useState } from 'react';
import { UploadScreen } from './components/UploadScreen';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { PdfProvider } from './context/PdfContext';
import { usePdf } from './hooks/usePdf';
import { Plus, Download } from 'lucide-react';
import { exportModifiedPdf } from './utils/pdf';
import './index.css';

const AppContent = () => {
  const { pages, documents, annotations, addFiles, clearAll } = usePdf();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportModifiedPdf(documents, pages, annotations, 1.5);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modified_document.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  };

  if (pages.length === 0) {
    return <UploadScreen onUpload={addFiles} />;
  }

  return (
    <div className="app-container">
      <Sidebar />
      
      <div className="workspace">
        <div className="glass" style={{ padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', borderRadius: 0, borderTop: 'none', borderLeft: 'none', borderRight: 'none', zIndex: 10 }}>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <label className="btn btn-secondary">
              <input 
                type="file" 
                multiple 
                accept="application/pdf" 
                style={{ display: 'none' }} 
                onChange={(e) => {
                  if (e.target.files) addFiles(Array.from(e.target.files));
                }}
              />
              <Plus size={16} /> Add PDFs to Merge
            </label>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={clearAll}>Start Over</button>
            <button className="btn btn-primary" onClick={handleExport} disabled={isExporting}>
              <Download size={16} /> {isExporting ? 'Exporting...' : 'Export PDF'}
            </button>
          </div>
        </div>
        
        <Workspace />
      </div>
    </div>
  );
};

function App() {
  return (
    <PdfProvider>
      <AppContent />
    </PdfProvider>
  );
}

export default App;
