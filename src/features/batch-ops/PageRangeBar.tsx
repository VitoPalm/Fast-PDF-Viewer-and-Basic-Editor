import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Scissors, Trash2, Download, CheckSquare, X, AlertTriangle } from 'lucide-react';
import { usePdf } from '../../shared/hooks/usePdf';
import { isImportJobBusy } from '../../context/importJob';
import { isOcrJobBusy } from '../../context/ocrJob';
import { isGlyphTextRepairJobBusy } from '../../context/glyphTextRepairJob';
import { isGlyphJobBusy } from '../../context/glyphRepairJob';
import { usePageRangeParser } from './usePageRangeParser';
import { exportModifiedPdf } from '../pdf-engine/utils';
import { pageIdsByNumbers } from '../page-operations/pageOperations';
import { PageStrip } from './PageStrip';
import './BatchOps.css';

export const PageRangeBar: React.FC = () => {
  const {
    pages, documents, annotations, importJob, ocrJob, glyphJob, glyphTextRepairJob,
    selectPagesByNumbers, removePagesWithUndo, keepOnlyPagesWithUndo,
    rangeInput: input, setRangeInput: setInput
  } = usePdf();
  const [isFocused, setIsFocused] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showStrip, setShowStrip] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rangeStatusId = useId();
  const rangeErrorId = useId();
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

  const getPageIdsByNumbers = useCallback((nums: number[]) => pageIdsByNumbers(pages, nums), [pages]);

  const handleExtract = useCallback(() => {
    if (!isValid || parsedPages.length === 0) return;
    const ids = getPageIdsByNumbers(parsedPages);
    keepOnlyPagesWithUndo(ids, { title: 'Keep only pages in range?', nextRangeInput: '' });
  }, [isValid, parsedPages, getPageIdsByNumbers, keepOnlyPagesWithUndo]);

  const handleRemove = useCallback(() => {
    if (!isValid || parsedPages.length === 0) return;
    const ids = getPageIdsByNumbers(parsedPages);
    removePagesWithUndo(ids, { title: 'Remove pages in range?', nextRangeInput: '' });
  }, [isValid, parsedPages, getPageIdsByNumbers, removePagesWithUndo]);

  const handleExportRange = useCallback(async () => {
    if (isImportJobBusy(importJob) || isOcrJobBusy(ocrJob) || isGlyphJobBusy(glyphJob) || isGlyphTextRepairJobBusy(glyphTextRepairJob)) {
      alert('Wait for import, OCR, text checks, and text repair jobs to finish before exporting.');
      return;
    }
    if (!isValid || parsedPages.length === 0) return;
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
  }, [annotations, documents, getPageIdsByNumbers, glyphJob, glyphTextRepairJob, importJob, input, isValid, ocrJob, pages, parsedPages]);

  const handleSelect = useCallback(() => {
    if (!isValid || parsedPages.length === 0) return;
    selectPagesByNumbers(parsedPages);
    setInput('');
  }, [isValid, parsedPages, selectPagesByNumbers, setInput]);

  const handleClear = () => {
    setInput('');
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
  const canRunActions = isValid && parsedPages.length > 0;
  const isImportBusy = isImportJobBusy(importJob);
  const isOcrBusy = isOcrJobBusy(ocrJob);
  const isGlyphBusy = isGlyphJobBusy(glyphJob);
  const isRepairBusy = isGlyphTextRepairJobBusy(glyphTextRepairJob);
  const pageMutationBusyReason = isImportBusy
    ? 'Import running; page changes are disabled.'
    : isOcrBusy
      ? 'OCR running; page changes are disabled.'
      : isGlyphBusy
        ? 'Text check running; page changes are disabled.'
        : isRepairBusy
          ? 'Text repair running; page changes are disabled.'
          : null;
  const exportBusyReason = isImportBusy
    ? 'Import running; export is disabled.'
    : isOcrBusy
      ? 'OCR running; export is disabled.'
      : isGlyphBusy
        ? 'Text check running; export is disabled.'
        : isRepairBusy
          ? 'Text repair running; export is disabled.'
          : null;
  const canExportRange = (
    canRunActions &&
    !isImportBusy &&
    !isOcrBusy &&
    !isGlyphBusy &&
    !isRepairBusy
  );
  const describedBy = [
    hasInput ? rangeStatusId : null,
    hasErrors ? rangeErrorId : null,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`page-range-bar ${isFocused ? 'focused' : ''} ${hasErrors ? 'has-errors' : ''}`}>
      <div className="page-range-input-row">
        <div className="page-range-input-wrapper" ref={wrapperRef}>
          <span className="page-range-icon">📖</span>
          <input
            ref={inputRef}
            type="text"
            className="page-range-input"
            aria-label="Page range"
            aria-invalid={hasErrors}
            aria-describedby={describedBy}
            placeholder={placeholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          {hasInput && (
            <button className="page-range-clear" onClick={handleClear} title="Clear" aria-label="Clear page range">
              <X size={14} />
            </button>
          )}
        </div>
        {showActions && (
          <div className="page-range-actions">
            <button className="page-range-action-btn extract" onClick={handleExtract} disabled={!canRunActions || Boolean(pageMutationBusyReason)} aria-describedby={pageMutationBusyReason ? rangeStatusId : undefined}>
              <Scissors size={14} />
              <span>Keep Only</span>
            </button>
            <button className="page-range-action-btn remove" onClick={handleRemove} disabled={!canRunActions || Boolean(pageMutationBusyReason)} aria-describedby={pageMutationBusyReason ? rangeStatusId : undefined}>
              <Trash2 size={14} />
              <span>Remove</span>
            </button>
            <button className="page-range-action-btn export" onClick={handleExportRange} disabled={!canExportRange || isExporting} aria-describedby={exportBusyReason ? rangeStatusId : undefined}>
              <Download size={14} />
              <span>{isExporting ? '...' : 'Save as PDF'}</span>
            </button>
            <button className="page-range-action-btn select" onClick={handleSelect} disabled={!canRunActions}>
              <CheckSquare size={14} />
              <span>Select</span>
            </button>
          </div>
        )}
      </div>
      {hasInput && (
        <div id={rangeStatusId} className="page-range-status" role="status" aria-live="polite">
          {isValid && parsedPages.length > 0 && <span className="page-range-count">{parsedPages.length} pages in range</span>}
          {(pageMutationBusyReason || exportBusyReason) && <span className="page-range-busy">{pageMutationBusyReason ?? exportBusyReason}</span>}
          {hasErrors && <span id={rangeErrorId} className="page-range-error"><AlertTriangle size={12} />{errors[0].token}: {errors[0].reason}</span>}
        </div>
      )}
      {showStrip && isValid && <PageStrip pageNumbers={parsedPages} />}
    </div>
  );
};
