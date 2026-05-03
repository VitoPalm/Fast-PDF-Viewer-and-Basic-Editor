import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Scissors, Trash2, Download, CheckSquare, X, AlertTriangle } from 'lucide-react';
import { usePdf } from '../hooks/usePdf';
import { usePageRangeParser } from '../hooks/usePageRangeParser';
import { exportModifiedPdf } from '../utils/pdf';
import { PageStrip } from './PageStrip';

export const PageRangeBar: React.FC = () => {
  const {
    pages, documents, annotations,
    selectPagesByNumbers, extractPages, removePages, clearSelection,
    rangeInput: input, setRangeInput: setInput
  } = usePdf();
  const [isFocused, setIsFocused] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showStrip, setShowStrip] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const totalPages = pages.length;

  const { pages: parsedPages, errors, isValid } = usePageRangeParser(input, totalPages);

  useEffect(() => {
    if (parsedPages.length > 0) {
      const frame = requestAnimationFrame(() => setShowStrip(true));
      return () => cancelAnimationFrame(frame);
    } else {
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
  }, [parsedPages, getPageIdsByNumbers, extractPages, setInput]);

  const handleRemove = useCallback(() => {
    if (parsedPages.length === 0) return;
    const ids = getPageIdsByNumbers(parsedPages);
    removePages(ids);
    setInput('');
  }, [parsedPages, getPageIdsByNumbers, removePages, setInput]);

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
  }, [parsedPages, selectPagesByNumbers, setInput]);

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

  const [placeholder, setPlaceholder] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 250) setPlaceholder(`Pages: e.g. 1-45, 78, 120-${totalPages}`);
        else if (w > 180) setPlaceholder('Pages: 1-10, 15...');
        else setPlaceholder('Pages...');
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [totalPages]);

  const hasInput = input.trim().length > 0;
  const hasErrors = errors.length > 0;
  const showActions = hasInput && parsedPages.length > 0;

  return (
    <div className={`page-range-bar ${isFocused ? 'focused' : ''} ${hasErrors ? 'has-errors' : ''}`}>
      <div className="page-range-input-row">
        <div className="page-range-input-wrapper" ref={wrapperRef}>
          <span className="page-range-icon">📖</span>
          <input
            ref={inputRef}
            type="text"
            className="page-range-input"
            placeholder={placeholder}
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
        {showActions && (
          <div className="page-range-actions">
            <button className="page-range-action-btn extract" onClick={handleExtract}>
              <Scissors size={14} />
              <span>Keep Only</span>
            </button>
            <button className="page-range-action-btn remove" onClick={handleRemove}>
              <Trash2 size={14} />
              <span>Remove</span>
            </button>
            <button className="page-range-action-btn export" onClick={handleExportRange} disabled={isExporting}>
              <Download size={14} />
              <span>{isExporting ? '...' : 'Save as PDF'}</span>
            </button>
            <button className="page-range-action-btn select" onClick={handleSelect}>
              <CheckSquare size={14} />
              <span>Select</span>
            </button>
          </div>
        )}
      </div>
      {hasInput && (
        <div className="page-range-status">
          {parsedPages.length > 0 && <span className="page-range-count">{parsedPages.length} pages selected</span>}
          {hasErrors && <span className="page-range-error"><AlertTriangle size={12} />{errors[0].reason}</span>}
        </div>
      )}
      {showStrip && <PageStrip pageNumbers={parsedPages} />}
    </div>
  );
};
