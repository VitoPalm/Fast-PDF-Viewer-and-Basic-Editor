import { createContext } from 'react';
import { type PdfContextType } from '../types/pdf';

export const PdfContext = createContext<PdfContextType | undefined>(undefined);
