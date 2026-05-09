import { createContext } from 'react';
import { type PdfContextType } from '../shared/types/pdf';

export const PdfContext = createContext<PdfContextType | undefined>(undefined);
