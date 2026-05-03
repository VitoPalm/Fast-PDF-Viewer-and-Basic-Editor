import { useContext } from 'react';
import { PdfContext } from '../context/PdfContext';

export function usePdf() {
  const context = useContext(PdfContext);
  if (!context) {
    throw new Error("usePdf must be used within PdfProvider");
  }
  return context;
}
