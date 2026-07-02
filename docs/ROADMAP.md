# Antigravity PDF Roadmap

Last updated: 2026-07-02

This document is the working product and engineering roadmap for Antigravity
PDF. It exists so product direction, test findings, technical decisions, and
future research do not live only in chat history.

The near-term priority is to make the current desktop app reliable and safe
before adding large new capabilities. Mobile is explicitly out of scope for the
current roadmap.

## Current Product Direction

Antigravity PDF is a desktop-first PDF viewer and repair/editor focused on:

- fast navigation of large PDF files;
- page ordering, merging, extracting, and exporting;
- OCR for scanned/image-based PDFs;
- repair of broken or garbled selectable text without rasterizing pages;
- future extensibility for annotations and direct PDF text editing.

The current Electron shell is acceptable for the first product stages, but core
PDF/business logic should be moved behind platform-neutral boundaries so a
future native shell can reuse the same engine from GTK/WebKitGTK, WinUI/WebView2,
or another native host.

## Roadmap Principles

1. Stabilize the current desktop workflows before adding new editing features.
2. Never let a destructive operation run from partially invalid input.
3. Prefer reversible operations, clear confirmations, and explicit progress.
4. Preserve vector PDFs whenever possible.
5. Avoid hidden network/runtime dependencies in packaged builds.
6. Keep platform-specific code behind a typed bridge.
7. Treat annotations as future roadmap work, not current priority.
8. Every meaningful change needs documentation and verification.

## Test Findings To Track

These issues came from Playwright diagnostics using real university PDF
fixtures, including the 665-page database book.

### Critical / High

- Mixed valid and invalid page ranges still enable actions. Example:
  `1-3,9999` shows an error but still allows `Select`, `Remove`, `Keep Only`,
  and `Save as PDF`, applying only the valid subset.
- Minimap click math jumps to the wrong page when the minimap is internally
  scrolled.
- Upload control is not keyboard reachable.
- Desktop narrow/mobile layouts expose significant clipping. Mobile is not a
  release target yet, but desktop/narrow clipping still matters.

### Medium

- Destructive actions run immediately with no confirmation or undo.
- Invert selection appears to be a no-op.
- Drag reorder is unstable around virtualized list boundaries and triggers
  `@hello-pangea/dnd` invariant errors.
- Large-document import has no progress feedback and currently analyzes every
  page before publishing usable state.
- Direct page jumps render the correct page but do not scroll the active
  thumbnail/minimap into view.
- Rapid sidebar scrolling causes measurable jank and memory growth.
- Native PDF text layers can be garbled even when the canvas renders correctly.
- OCR detection misses some low-text/scan-like PDFs.
- Single-page OCR works, but overlay geometry/text quality can be poor.
- OCR completion can leave stale "needs OCR" sidebar badges.
- Default 150% zoom crops wide slides; the floating page/zoom pill can cover
  content.
- Icon-only controls lack accessible names.

### Working Behaviors

- Click upload and drag/drop upload work.
- Multi-document add/merge flow works.
- Range export and full export work for tested fixtures.
- 665-page document loading is possible on the test machine.
- Direct page jumps are fast once a large document is loaded.
- Basic keyboard page navigation, zoom, and pan work.
- Single-page OCR completes without crashing.

## Phase 0: Project Hygiene And Documentation

Goal: make future work repeatable and auditable.

### Tasks

- Add and maintain this roadmap.
- Add a `docs/` index when more docs exist.
- Add ADRs for major irreversible choices:
  - OCR architecture;
  - glyph text repair engine;
  - packaging/install strategy;
  - platform bridge/native portability;
  - licensing posture.
- Keep Playwright diagnostic artifacts under `output/playwright/` or another
  ignored/generated artifact path.
- Add a convention for test fixtures:
  - local private fixtures may live outside the repo;
  - minimal synthetic fixtures should be committed only when license-safe;
  - large or copyrighted fixtures should be referenced by path/recipe, not
    committed.

### Documentation Rule

Each non-trivial PR should update at least one of:

- roadmap status;
- feature documentation;
- test fixture notes;
- ADR;
- release notes/changelog;
- developer setup docs.

## Phase 1: Stabilize Existing Desktop App

Goal: remove serious workflow bugs and make current behavior safe.

### Batch 1 Implementation Note

Status: implemented on 2026-07-02.

Completed:

- invalid mixed ranges now disable range actions;
- out-of-bounds range ends are validation errors, not silently clamped;
- pure page-operation helpers now cover selection, remove, keep-only, reorder,
  selected-block reorder, and next-active-page calculation;
- structural page mutations now use custom confirmations and one-level
  short-lived undo;
- sidebar/minimap active-page sync and scrolled minimap click behavior are
  covered by regression tests;
- virtualized drag success/cancel behavior is covered by Playwright regression;
- Start Over, thumbnail removal, selected removal, range removal, and Keep Only
  confirmation/undo paths are covered by Playwright regression;
- Vitest and Playwright regression infrastructure were added.
- packaged Electron smoke tests now launch the unpacked build and cover upload,
  invalid range gating, destructive confirmation/undo, and page-jump/sidebar
  sync.

Still outside Batch 1:

- OCR job model refactor;
- Clean OCR native bridge rewrite;
- glyph text repair;
- native boundary and release hardening.

### Workstream A: Range And Destructive Safety

Owner scope:

- `src/features/batch-ops/*`
- page-operation helpers in context/core modules
- relevant unit tests

Tasks:

- Block all range actions unless the parsed range is fully valid.
- Stop silently clamping invalid range ends for destructive operations.
- Show invalid token details and disable action buttons.
- Extract pure page operations:
  - select pages by current position;
  - remove pages;
  - keep only pages;
  - reorder single page;
  - reorder selected block.
- Add confirmation summaries for:
  - Start Over;
  - single-page remove;
  - selected remove;
  - range Remove;
  - Keep Only;
  - Clean OCR.
- Add short-lived undo for structural page mutations.
- Fix range Clear behavior so it does not unexpectedly clear unrelated
  selection unless explicitly documented in the UI.

Acceptance criteria:

- `1-3,9999` enables no mutating/export action.
- Invalid ranges never mutate page state.
- Destructive actions show operation name and affected count.
- Unit tests cover mixed valid/invalid input and page-operation invariants.

### Workstream B: Sidebar, Minimap, And Reorder

Owner scope:

- `src/features/sidebar/*`
- pure reorder helpers if not owned by Workstream A
- sidebar/minimap tests

Tasks:

- Fix minimap click and drag math with internal minimap scroll offset.
- Sync sidebar/minimap position when active page changes from workspace:
  - direct page entry;
  - arrow keys;
  - page nav buttons;
  - minimap click;
  - search/range jump in future.
- Fix selected-block reorder:
  - do not mutate global order during drag start;
  - keep original order in a drag session ref;
  - commit only on valid drop;
  - restore on cancel/no destination.
- Fix virtual list placeholder invariant from `@hello-pangea/dnd`.
- Add a visible scrollbar or clearer scroll affordance for large docs.
- Add accessible names and keyboard behavior where practical.

Acceptance criteria:

- Clicking minimap near the bottom of a 665-page file targets the expected page.
- Jumping to page 333 scrolls sidebar/minimap to page 333.
- Cancelled drag leaves page order unchanged.
- Reordering around virtualized boundaries does not produce console errors.

### Workstream C: PDF Import, Large-Document Mode, And Progress

Owner scope:

- `src/context/*`
- `src/features/pdf-engine/*`
- import/progress UI integration points

Tasks:

- Replace `isLoading` with import job state:
  - current file;
  - files complete/total;
  - page count discovered;
  - pages instantiated;
  - pages analyzed;
  - current phase;
  - errors;
  - cancellation flag.
- Publish page placeholders as soon as page count is known.
- Analyze visible and nearby pages first.
- Queue off-screen page analysis lazily.
- Add cancellation when Start Over/Clear All happens.
- Destroy old PDF.js document references and render caches on Clear All.
- Add progress UI on initial upload and Add PDFs to Merge.

Acceptance criteria:

- Large file shows progress within one second.
- First page can render before all pages are analyzed.
- Clearing during import does not append late pages afterward.
- Re-loading multiple large files does not keep old render caches alive.

### Batch 2 Implementation Note

Status: implemented on 2026-07-02.

Completed:

- import jobs publish page placeholders before background analysis completes;
- upload and Add PDFs to Merge show import progress;
- Start Over/Clear All cancels stale import work;
- page thumbnails show analysis pending/running/failed state;
- lint/type debt around OCR processing, PDF.js analysis, Electron preload
  declarations, and Workspace canvas refs was cleared;
- unit, desktop Playwright, and packaged smoke coverage were added for large
  import progress.

### Workstream D: OCR State And Existing OCR Flow

Owner scope:

- `src/context/*`
- `src/features/pdf-engine/ocrService.ts`
- `src/features/workspace/*`
- `src/features/sidebar/*` badge rendering only

Tasks:

- Add page-level OCR state:
  - `idle`;
  - `queued`;
  - `running`;
  - `complete`;
  - `failed`;
  - `skipped`.
- Make selected-page OCR actually consume the selected queue.
- Unify single-page, selected-page, and batch OCR under one job model.
- Update page analysis when OCR completes so stale "needs OCR" badges disappear.
- Add retry and partial-results semantics.
- Add cancellation that preserves completed pages.
- Add OCR language override later, after the basic job model is stable.
- Avoid re-scanning pages that already have a usable image/render target for OCR.
  Cache or reuse page render output when possible.
- Avoid OCR for pages with a healthy text layer unless user explicitly requests
  repair/rescan.

Acceptance criteria:

- Sidebar selected OCR runs on selected scanned pages.
- OCR completion updates workspace and sidebar state.
- Cancelling batch OCR preserves completed results and marks skipped pages.
- OCR does not re-render the same page unnecessarily within one job.

### Batch 3 Implementation Note

Status: implemented on 2026-07-02.

Completed:

- OCR job state is now first-class in context;
- single-page, selected-page, and batch OCR use the same runner;
- selected-page OCR now consumes the selected scanned page ids;
- cancellation preserves completed OCR results and marks queued/running pages
  skipped;
- failed OCR pages can be retried;
- OCR completion updates page analysis so stale scanned-page badges disappear.

Still outside Batch 3:

- Clean OCR native bridge rewrite;
- OCR language override UI;
- vendored/offline Tesseract assets;
- text-layer health and glyph repair routing.

### Batch 4 Implementation Note

Status: implemented on 2026-07-02.

Completed:

- renderer no longer exposes generic Electron IPC;
- Clean OCR now uses a typed `window.antigravityPdf.cleanOcrPage` bridge;
- Clean OCR IPC validates byte payloads and 1-indexed page numbers before
  Ghostscript runs;
- Ghostscript virtual file-system cleanup now runs in `finally`;
- browser-only renderer mode reports Clean OCR as unavailable instead of
  throwing on missing IPC;
- page analysis now records text-layer health:
  `healthy`, `hiddenOcr`, `sparse`, `suspectEncoding`, `imageOnly`, and
  `unsupported`;
- suspect or unsupported native text layers are not rendered as selectable DOM
  text;
- workspace and sidebar surface non-destructive text-layer health diagnostics.

Still outside Batch 4:

- OCR language override UI;
- vendored/offline Tesseract assets;
- deterministic glyph text repair and mutation;
- deeper font/ToUnicode diagnostics beyond PDF.js text-content heuristics.

### Workstream E: Clean OCR Native Boundary

Owner scope:

- `electron/main.ts`
- `electron/preload.ts`
- `src/shared/types/electron.ts`
- native PDF utility calls in `src/features/pdf-engine/*`

Tasks:

- Replace raw `window.ipcRenderer` exposure with a narrow typed API.
- Define `cleanOcrPage` IPC contract explicitly:
  - PDF bytes;
  - 1-indexed page number;
  - options;
  - typed result/error.
- Remove the off-by-one page conversion in Electron main.
- Validate page number and input bytes in main.
- Clean Ghostscript virtual file system files in `finally`.
- In browser-only renderer mode, disable Clean OCR or show a precise
  "Electron native feature unavailable" state.

Acceptance criteria:

- Browser renderer no longer throws `window.ipcRenderer` undefined for Clean OCR.
- Electron Clean OCR targets the requested page.
- Main process rejects invalid page numbers.
- Preload no longer exposes generic IPC send/invoke.

### Workstream F: Text Layer Health

Owner scope:

- new `src/features/pdf-engine/textLayerHealth.ts`
- `utils.ts` analysis integration
- workspace text-layer render decisions

Tasks:

- Centralize text extraction health:
  - `healthy`;
  - `hiddenOcr`;
  - `sparse`;
  - `suspectEncoding`;
  - `imageOnly`;
  - `unsupported`.
- Detect garbled text heuristically:
  - control-character ratio;
  - replacement/private-use characters;
  - improbable language distribution;
  - mismatch between visible text quantity and extracted text quantity;
  - known broken ToUnicode patterns.
- Stop blindly trusting native text layer when health is suspect.
- Surface a non-destructive "Text layer appears broken" prompt.
- Add compatibility hooks for future glyph text repair.

Acceptance criteria:

- DB chapter fixture with garbled DOM text is marked `suspectEncoding`.
- Healthy text PDFs still expose native selectable text.
- Scanned/image-only pages route to OCR.
- Suspect text pages route to future repair/OCR choices without corrupting export.

### Workstream G: Lint, Types, And Test Harness

Owner scope:

- `package.json`
- TS/ESLint configs
- test config
- unit and e2e test files

Tasks:

- Add scripts:
  - `typecheck`;
  - `lint`;
  - `test`;
  - `test:e2e`;
  - `build:renderer`;
  - `build:electron`;
  - `package`;
  - `release`.
- Include Electron main/preload in TypeScript checks.
- Add a test runner for unit tests.
- Add Playwright e2e tests for desktop workflows.
- Fix current lint failures:
  - Tesseract result typing;
  - IPC types;
  - React ref access during render;
  - hook dependency warnings;
  - `prefer-const`.

Acceptance criteria:

- CI can run typecheck, lint, unit tests, and renderer build without packaging.
- Current Playwright regression cases are represented as automated tests or
  documented manual test scripts.

## Phase 2: Product UX Improvements

Goal: make the desktop workflow intuitive, resilient, and pleasant without
sacrificing density.

### Tasks

- Replace generic upload copy with practical product language.
- Add import/progress surface.
- Add a job/activity panel for import, OCR, export, and repair operations.
- Add fit modes:
  - Fit Width;
  - Fit Page;
  - 100%;
  - custom zoom.
- Default wide pages to fit width or fit page instead of fixed 150%.
- Preserve viewport center when zoom changes.
- Move or dock the bottom page/zoom pill so it does not cover content.
- Add clear page entry affordance.
- Add accessible names for all icon-only controls.
- Add `aria-live` status for progress.
- Add a large-doc mode indicator and filters:
  - scanned pages;
  - suspect text layer pages;
  - OCR complete/failed;
  - document/source grouping.
- Improve range workflow into an operation planner with preview, validation,
  and final confirmation.

## Phase 3: Packaging, CI, And Release Pipeline

Goal: make releases reproducible, offline-capable, and legally distributable.

### Current Release Problems

- CI uses `npm install`; should use `npm ci`.
- PR CI runs full `npm run build`, which invokes `electron-builder` packaging.
- Release workflow skips `tsc -b` in `electron:build`.
- Release workflow mutates `package.json` inside CI based on tag.
- Repo has no detected license, while README claims MIT.
- GhostPDL/Ghostscript dependency is AGPL-3.0-or-later/commercial.
- PDF.js CMaps/fonts and Tesseract worker/core/lang data load from CDNs.
- macOS/Windows artifacts are unsigned/not notarized.
- No SBOM, checksums, third-party notices, or install smoke tests.

### Tasks

- Split CI quality gates from packaging.
- Add OS matrix:
  - Ubuntu;
  - Windows;
  - macOS.
- Add packaging smoke jobs using `electron-builder --dir`.
- Generate and upload debug artifacts only from smoke jobs.
- Gate tag release on successful CI.
- Stop mutating version inside release workflow.
- Add release draft workflow with:
  - artifacts;
  - checksums;
  - SBOM;
  - third-party notices;
  - changelog/release notes.
- Decide licensing posture before public binary distribution:
  - comply with AGPL;
  - obtain commercial Ghostscript license;
  - replace Ghostscript path;
  - make Ghostscript user-provided/optional.
- Vendor PDF.js CMaps/standard fonts.
- Vendor Tesseract worker/core WASM and default language data.
- Add network-disabled smoke tests for packaged builds.
- Add Windows NSIS installer.
- Keep Windows portable as secondary.
- Keep Linux AppImage/deb; consider rpm/tar.gz.
- Add macOS signing/notarization plan when Apple access is available.
- Add update strategy only after signing is clear.

## Phase 4: Glyph Text Repair

Goal: repair garbled selectable text while preserving vector rendering and file
size, avoiding image-based OCR overlays when a PDF already contains useful
glyph geometry.

### Problem Model

Some PDFs render correctly but copy/search incorrectly because PDF text
extraction maps stored character codes/CIDs to the wrong Unicode characters.
The visible rendering may be correct because the content stream still selects
the right glyphs from the embedded font. The best repair is usually to fix or
add the font's `/ToUnicode` CMap, not to rasterize the page or add a hidden OCR
text layer.

Primary references:

- Adobe ToUnicode Mapping File Tutorial:
  https://pdfa.org/norm-refs/5411.ToUnicode.pdf
- Adobe Mapping Resources for PDF:
  https://github.com/adobe-type-tools/mapping-resources-pdf
- pikepdf content streams:
  https://pikepdf.readthedocs.io/en/latest/topics/content_streams.html
- qpdf manual:
  https://qpdf.readthedocs.io/
- PDFium README/testing notes:
  https://pdfium.googlesource.com/pdfium/+/master/README.md

### Architecture

Add a separate glyph repair service, not an extension of the OCR overlay
service.

Proposed API:

```ts
repairGlyphText(pdfBytes, pageSelection, options): Promise<{
  repairedPdfBytes: Uint8Array;
  report: GlyphRepairReport;
}>
```

Pipeline:

1. Detect suspect text:
   - PDF.js `getTextContent`;
   - text-layer health heuristic;
   - language/garbling score;
   - user-triggered repair.
2. Analyze glyph events:
   - parse `BT`/`ET`;
   - track font switches;
   - parse `Tj`, `TJ`, single quote, double quote text-showing operators;
   - capture raw char codes/CIDs, font resource, text matrix, advance width,
     bounding boxes, current Unicode.
3. Infer mapping:
   - existing encoding;
   - `/ToUnicode`;
   - predefined CMaps;
   - `/CIDToGIDMap`;
   - embedded font `cmap`;
   - glyph names;
   - repeated glyph outline clusters;
   - OCR-assisted line/word alignment when deterministic recovery fails.
4. Write repair:
   - preferred: attach generated `/ToUnicode` stream to affected font objects;
   - fallback: use `/ActualText` marked content for position-specific cases;
   - last resort: hidden OCR layer only if vector semantic repair is impossible.
5. Validate:
   - render original and repaired PDF at 150 and 300 DPI;
   - pixel diff below threshold;
   - extraction through PDF.js and one independent engine;
   - `qpdf --check`;
   - report ambiguities instead of auto-writing low-confidence repairs.

### Candidate Engines

- Apache PDFBox + FontBox:
  - best fit for glyph-event analysis and font internals;
  - Apache-2.0;
  - likely sidecar JAR or bundled runtime.
- pikepdf/qpdf:
  - strong for object/stream surgery;
  - pikepdf is Python + qpdf and low-level;
  - qpdf is structural, not a renderer or extractor.
- PDFium/pypdfium2:
  - good independent render/extraction validator;
  - native binary packaging implications.
- MuPDF/Poppler:
  - useful for validation or prototypes;
  - licensing needs careful review before bundling.
- pdf-lib:
  - keep for current structural exports;
  - not the primary tool for ToUnicode/content-stream repair.

### Glyph Repair Phases

#### Phase 4A: Diagnostics Only

- Build read-only diagnostic service.
- Report:
  - fonts per page;
  - font type;
  - `/ToUnicode` presence;
  - encoding;
  - embedded font metadata;
  - raw char code samples;
  - extracted text samples;
  - suspect score.
- Add UI badge: "Text layer suspect".
- No PDF mutation.

#### Phase 4B: Deterministic ToUnicode Repair

- Generate `/ToUnicode` for simple recoverable cases:
  - simple fonts with encoding differences;
  - Type0 Identity-H fonts with recoverable CID/GID mapping;
  - subset fonts with reliable embedded `cmap`.
- Validate visual identity and extraction.
- Add repair report UI.

#### Phase 4C: OCR-Assisted Mapping

- Render page regions.
- OCR at line/word level.
- Align OCR boxes to glyph events by geometry and advance widths.
- Infer per-font/per-code mapping with confidence.
- Write only high-confidence mappings.
- Present ambiguous mappings for review or skip.

#### Phase 4D: Batch Repair And Export Integration

- Add batch repair for selected/all suspect pages.
- Integrate with export pipeline.
- Add job queue, cancellation, retry, and partial-results reporting.
- Keep repaired source document separate from original until user saves/exports.

### Synthetic Fixtures

Commit only license-safe minimal PDFs for:

- missing `/ToUnicode`;
- wrong `/ToUnicode`;
- Type0 Identity-H CIDFont;
- 8-bit simple font with custom encoding differences;
- ligature glyph mapping to multi-character Unicode;
- `TJ` kerning arrays;
- rotated text;
- Form XObject text;
- clipped text;
- CJK predefined CMap;
- Type3 font;
- encrypted negative case;
- scanned-only negative case;
- text converted to outlines negative case;
- ambiguous same-code/different-character case.

### Acceptance Criteria

- Repaired PDF visual rendering is unchanged within pixel threshold.
- Repaired extraction matches fixture ground truth through PDF.js and one
  independent engine.
- Repaired PDF passes `qpdf --check`.
- File size growth is bounded and explained in the report.
- No rasterization unless user explicitly chooses OCR fallback.
- Ambiguous mappings are reported, not silently written.
- Digital signatures/encrypted PDFs are detected before mutation.

## Phase 5: Platform-Neutral Core And Native Portability

Goal: prepare for a future non-Electron shell.

### Core Boundary

Move these into platform-neutral modules:

- document model;
- page operations;
- range parser;
- import job state;
- OCR job orchestration interface;
- glyph repair service interface;
- export planning;
- validation/report types.

### Platform Bridge

Replace raw Electron calls with a typed bridge:

```ts
interface PlatformBridge {
  files: {
    openPdfFiles(): Promise<FileLike[]>;
    saveFile(defaultName: string, bytes: Uint8Array): Promise<void>;
  };
  pdfNative: {
    cleanOcrPage(input: CleanOcrInput): Promise<CleanOcrResult>;
    repairGlyphText(input: GlyphRepairInput): Promise<GlyphRepairResult>;
  };
  system: {
    getInfo(): Promise<SystemInfo>;
  };
  updates?: {
    check(): Promise<UpdateStatus>;
  };
}
```

Electron should become one adapter. A future GTK or WinUI shell should be able
to implement the same bridge without rewriting PDF business logic.

## Future Roadmap Entries

### Annotations

Not a current priority. Keep extension points for later:

- text annotations;
- drawing;
- image paste;
- shapes/highlights;
- export-layer handling.

### Direct PDF Text Editing

Long-term separate release. This would need:

- text object discovery;
- font/glyph reuse;
- synthetic font generation or font matching;
- layout reflow or localized replacement;
- OCR-backed editing for image-based PDFs;
- user-facing editing controls;
- visual validation.

This is intentionally after stabilization, OCR repair, glyph repair, and export
pipeline maturity.

## Agent Work Plan For Parallel Execution

Agents should own disjoint write sets to avoid conflicts.

### Agent A: Range And Safety

Write scope:

- `src/features/batch-ops/*`
- page operation helpers/tests

Deliverables:

- valid-only range actions;
- confirmation/undo scaffolding for range operations;
- unit tests.

### Agent B: Sidebar, Minimap, Reorder

Write scope:

- `src/features/sidebar/*`
- sidebar-specific tests

Deliverables:

- minimap click fix;
- active-page scroll sync;
- stable virtual drag/reorder;
- accessibility labels for sidebar controls.

### Agent C: Import And Core State

Write scope:

- `src/context/*`
- `src/shared/types/pdf.ts`
- import job tests

Deliverables:

- import progress model;
- placeholder page publishing;
- lazy analysis queue;
- cleanup/cancellation semantics.

### Agent D: OCR State And Workspace

Write scope:

- `src/features/workspace/*`
- `src/features/pdf-engine/ocrService.ts`
- OCR state integration tests

Deliverables:

- unified OCR job state;
- selected-page OCR consumer;
- stale badge fixes;
- single/batch cancellation semantics.

### Agent E: Native Boundary

Write scope:

- `electron/*`
- `src/shared/types/electron.d.ts`
- platform bridge modules
- native-boundary tests

Deliverables:

- narrow preload API;
- Clean OCR page-number contract;
- browser-mode unavailable handling.

### Agent F: Text Health And Glyph Repair Research Spike

Write scope:

- `src/features/pdf-engine/textLayerHealth.ts`
- `docs/adr/*`
- prototype scripts under a clearly named experimental folder if approved

Deliverables:

- text-layer health helper;
- suspect-encoding detection;
- glyph repair diagnostic design;
- fixture list and acceptance tests.

### Agent G: Tooling, CI, Release

Write scope:

- `package.json`
- `.github/workflows/*`
- TS/ESLint/test configs
- release docs

Deliverables:

- split scripts;
- CI quality gates;
- release smoke plan;
- license/SBOM plan.

### Agent H: Desktop UX

Write scope:

- UX components/CSS agreed with other agents;
- docs for workflow decisions.

Deliverables:

- fit-width/default zoom controls;
- progress/activity surface;
- safe action dialogs;
- accessible labels;
- desktop onboarding copy.

## Documentation Checklist For Future Work

Before merging meaningful changes:

- Update this roadmap if priorities/status changed.
- Add or update ADR for architectural decisions.
- Add test fixture notes for new PDF cases.
- Add Playwright artifact links for workflow regressions.
- Document platform-specific dependencies.
- Document licensing impact.
- Update README only for user-facing setup/run/release changes.
