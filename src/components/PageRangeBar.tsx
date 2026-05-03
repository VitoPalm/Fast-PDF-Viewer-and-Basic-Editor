import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Scissors, Trash2, Download, CheckSquare, X, AlertTriangle } from 'lucide-react';
import { usePdf } from '../context/PdfContext';
import { usePageRangeParser } from '../hooks/usePageRangeParser';
import { exportModifiedPdf } from '../utils/pdf';
import { PageStrip } from './PageStrip';

export const PageRangeBar: React.FC = () => {
  const {
    pages, documents, annotations,
    selectPagesByNumbers, extractPages, removePages, clearSelection
  } = usePdf();
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showStrip, setShowStrip] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const totalPages = pages.length;

  const { pages: parsedPages, errors, isValid } = usePageRangeParser(input, totalPages);

  // Show the strip when there are valid pages
  useEffect(() => {
    if (parsedPages.length > 0) {
      setShowStrip(true);
    } else {
      // Small delay before hiding for exit animation
      const t = setTimeout(() => setShowStrip(false), 300);
      return () => clearTimeout(t);
    }
  }, [parsedPages.length]);

  const getPageIdsByNumbers = useCallback((nums: number[]) => {
    return nums.map(n => pages[n - 1]?.id).filter(Boolean) as string[];
  }, [pages]);

  const handleExtract = useCallback(() => {
    if (parsedPages.length === 0) return;
    const ids = getPageIdsByNumbers(parsedPages);
    extractPages(ids);
    setInput('');
  }, [parsedPages, getPageIdsByNumbers, extractPages]);

  const handleRemove = useCallback(() => {
    if (parsedPages.length === 0) return;
    const ids = getPageIdsByNumbers(parsedPages);
    removePages(ids);
    setInput('');
  }, [parsedPages, getPageIdsByNumbers, removePages]);

  const handleExportRange = useCallback(async () => {
    if (parsedPages.length === 0) return;
    setIsExporting(true);
    try {
      const ids = getPageIdsByNumbers(parsedPages);
      const idSet = new Set(ids);
      const selectedPages = pages.filter(p => idSet.has(p.id));
      const blob = await exportModifiedPdf(documents, selectedPages, annotations, 1.5);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pages_${input.replace(/\s+/g, '')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to export range');
    } finally {
      setIsExporting(false);
    }
  }, [parsedPages, getPageIdsByNumbers, pages, documents, annotations, input]);

  const handleSelect = useCallback(() => {
    if (parsedPages.length === 0) return;
    selectPagesByNumbers(parsedPages);
    setInput('');
  }, [parsedPages, selectPagesByNumbers]);

  const handleClear = () => {
    setInput('');
    clearSelection();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isValid) {
      handleSelect();
    }
    if (e.key === 'Escape') {
      setInput('');
      inputRef.current?.blur();
    }
  };

  const hasInput = input.trim().length > 0;
  const hasErrors = errors.length > 0;
  const showActions = hasInput && parsedPages.length > 0;

  return (
    <div className={`page-range-bar ${isFocused ? 'focused' : ''} ${hasErrors ? 'has-errors' : ''}`}>
      {/* Input row */}
      <div className="page-range-input-row">
        <div className="page-range-input-wrapper">
          <span className="page-range-icon">📖</span>
          <input
            ref={inputRef}
            type="text"
            className="page-range-input"
            placeholder={`Pages: e.g. 1-45, 78, 120-${totalPages}`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          {hasInput && (
            <button className="page-range-clear" onClick={handleClear} title="Clear">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Action buttons */}
        {showActions && (
          <div className="page-range-actions">
            <button
              className="page-range-action-btn extract"
              onClick={handleExtract}
              title={`Keep only these ${parsedPages.length} pages and remove the rest from the workspace`}
            >
              <Scissors size={14} />
              <span>Keep Only</span>
            </button>
            <button
              className="page-range-action-btn remove"
              onClick={handleRemove}
              title={`Remove these ${parsedPages.length} pages from the workspace`}
            >
              <Trash2 size={14} />
              <span>Remove</span>
            </button>
            <button
              className="page-range-action-btn export"
              onClick={handleExportRange}
              disabled={isExporting}
              title={`Download these ${parsedPages.length} pages as a brand new PDF file (workspace is unaffected)`}
            >
              <Download size={14} />
              <span>{isExporting ? '...' : 'Save as PDF'}</span>
            </button>
            <button
              className="page-range-action-btn select"
              onClick={handleSelect}
              title={`Select ${parsedPages.length} pages in sidebar`}
            >
              <CheckSquare size={14} />
              <span>Select</span>
            </button>
          </div>
        )}
      </div>

      {/* Status line */}
      {hasInput && (
        <div className="page-range-status">
          {parsedPages.length > 0 && (
            <span className="page-range-count">
              {parsedPages.length} page{parsedPages.length !== 1 ? 's' : ''} selected
            </span>
          )}
          {hasErrors && (
            <span className="page-range-error">
              <AlertTriangle size={12} />
              {errors[0].reason}
            </span>
          )}
        </div>
      )}

      {/* Filmstrip preview */}
      {showStrip && (
        <PageStrip pageNumbers={parsedPages} />
      )}
    </div>
  );
};
