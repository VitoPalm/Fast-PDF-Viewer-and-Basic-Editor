import { UploadScreen } from './features/upload/UploadScreen';
import { Sidebar } from './features/sidebar/Sidebar';
import { Workspace } from './features/workspace/Workspace';
import { PdfProvider } from './context/PdfContext';
import { usePdf } from './shared/hooks/usePdf';
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
