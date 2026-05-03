import { UploadScreen } from './components/UploadScreen';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { PdfProvider } from './context/PdfContext';
import { usePdf } from './hooks/usePdf';
import './index.css';

const AppContent = () => {
  const { pages, addFiles } = usePdf();

  if (pages.length === 0) {
    return <UploadScreen onUpload={addFiles} />;
  }

  return (
    <div className="app-container">
      <Sidebar />
      
      <div className="workspace">
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
