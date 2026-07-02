# Project Overview

Last updated: 2026-07-02

Antigravity PDF is currently an Electron + React + Vite + TypeScript desktop
app for viewing, reorganizing, merging, exporting, and OCR-processing PDF
pages.

## Main Technologies

- Electron shell with Vite-built renderer.
- React UI with feature folders under `src/features`.
- PDF.js for rendering and text extraction.
- pdf-lib for page copying/export.
- Tesseract.js for OCR.
- GhostPDL/Ghostscript WASM path for the current Clean OCR flow.
- Apache PDFBox/FontBox Java sidecar for glyph text diagnostics and
  deterministic `/ToUnicode` repair.
- GitHub Actions plus electron-builder for CI/release packaging.

## Primary Source Areas

- `src/context/PdfContext.tsx`: page/document state, import, export, selection,
  and page mutation workflows.
- `src/features/pdf-engine/`: PDF loading, rendering, OCR, and PDF utility
  functions.
- `src/features/workspace/`: main document canvas, zoom/pan/page navigation,
  text layer, OCR actions.
- `src/features/sidebar/`: page thumbnails, minimap, selection, removal,
  reordering, and selected-page OCR entry points.
- `src/features/batch-ops/`: range parsing and batch operations.
- `electron/`: native shell, preload bridge, and Clean OCR IPC.
- `native/glyph-repair/`: PDFBox-based glyph diagnostics sidecar used by the
  Electron bridge.
- `.github/workflows/`: CI and release automation.

## Current User Workflows

- Upload one or more PDFs from the landing/upload screen.
- Add more PDFs to merge into the current document.
- Navigate by workspace controls, keyboard arrows, sidebar thumbnails, and
  minimap.
- Select pages from thumbnails or from a range.
- Remove, keep, reorder, and export pages.
- Run OCR on a page, and partially on selected pages through the current UI.
- Clean OCR through the Electron native bridge when running in the packaged or
  Electron app.
- Diagnose suspect glyph mappings on pages with broken selectable text.
- Repair deterministic glyph mappings by adding `/ToUnicode` maps while
  preserving vector artwork.
- Repair selected/suspect pages in sequence, including strict OCR-assisted
  replacement when existing OCR text aligns one-for-one with glyph events.

## Architectural Observations

- Page state is page-first, with imported pages represented in app state rather
  than keeping one immutable document model per source PDF.
- Import now uses a context-level job model, publishing page placeholders before
  background analysis completes.
- PDF.js rendering, text extraction, OCR, and export are still mostly renderer
  concerns; native Clean OCR now sits behind a narrow typed bridge.
- The renderer no longer exposes generic Electron IPC for native operations.
- Core page operations need pure helpers so UI validation and data mutation do
  not drift apart.
- OCR now uses a first-class job model shared by single-page, selected-page,
  and batch flows.
- Page analysis now includes text-layer health so suspect native text can be
  routed away from blind DOM text rendering before glyph repair exists.
- Glyph text diagnostics and guarded repair now run through a separate PDFBox
  sidecar, not the OCR overlay path. OCR-assisted mapping is intentionally
  strict: mismatched or conflicting glyph/text alignment is skipped with a
  report instead of guessed.

## Current Build And Release Shape

- `npm run lint`, unit tests, `npx tsc -b --pretty false`, and the Java glyph
  sidecar build pass locally when Java and Maven are installed.
- CI currently runs the packaging-oriented `build` script, not a lightweight
  quality-gate script.
- Release workflow publishes from `v*` tags but should be hardened with type
  checks, deterministic versioning, signing/notarization, checksums, SBOM, and
  third-party notices.
- README claims MIT, but the repo has no root license file detected and the
  GhostPDL/Ghostscript dependency has AGPL/commercial implications.

## Immediate Engineering Priorities

1. Treat 1.8.0 as the first guarded glyph repair baseline.
2. Add stronger synthetic fixtures for missing, wrong, Type0, ligature, and
   ambiguous `/ToUnicode` cases.
3. Improve OCR-assisted alignment beyond one-font, one-codepoint-per-glyph
   pages without introducing low-confidence mutation.
4. Bundle or locate a Java runtime for packaged glyph diagnostics and repair.
5. Resolve release, licensing, and bundled asset strategy before public binary
   distribution.
