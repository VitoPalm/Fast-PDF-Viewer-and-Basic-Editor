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
- `.github/workflows/`: CI and release automation.

## Current User Workflows

- Upload one or more PDFs from the landing/upload screen.
- Add more PDFs to merge into the current document.
- Navigate by workspace controls, keyboard arrows, sidebar thumbnails, and
  minimap.
- Select pages from thumbnails or from a range.
- Remove, keep, reorder, and export pages.
- Run OCR on a page, and partially on selected pages through the current UI.
- Attempt Clean OCR through the Electron native path.

## Architectural Observations

- Page state is page-first, with imported pages represented in app state rather
  than keeping one immutable document model per source PDF.
- Import now uses a context-level job model, publishing page placeholders before
  background analysis completes.
- PDF.js rendering, text extraction, OCR, export, and native Clean OCR are not
  yet separated by a stable platform boundary.
- The renderer currently reaches too directly into Electron IPC for native
  operations.
- Core page operations need pure helpers so UI validation and data mutation do
  not drift apart.
- OCR now uses a first-class job model shared by single-page, selected-page,
  and batch flows.
- Future glyph text repair should be separate from OCR overlay generation. It
  should repair text mapping metadata, preferably `/ToUnicode`, while preserving
  vector rendering.

## Current Build And Release Shape

- `npm run lint`, unit tests, and `npx tsc -b --pretty false` pass locally.
- CI currently runs the packaging-oriented `build` script, not a lightweight
  quality-gate script.
- Release workflow publishes from `v*` tags but should be hardened with type
  checks, deterministic versioning, signing/notarization, checksums, SBOM, and
  third-party notices.
- README claims MIT, but the repo has no root license file detected and the
  GhostPDL/Ghostscript dependency has AGPL/commercial implications.

## Immediate Engineering Priorities

1. Block unsafe destructive operations from invalid ranges.
2. Fix sidebar/minimap sync and virtualized reorder behavior.
3. Narrow and type the Electron/native bridge.
4. Add text-layer health diagnostics before glyph repair.
5. Resolve release, licensing, and bundled asset strategy before public binary
   distribution.
