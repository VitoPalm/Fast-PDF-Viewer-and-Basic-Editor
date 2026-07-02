# Playwright Diagnostics

Last updated: 2026-07-02

This note records the desktop UI/UX diagnostic pass performed with Playwright
and multiple focused agents. Mobile is intentionally out of scope for current
release planning, but narrow desktop issues were still recorded when they
affected usability.

## Environment

- App command: `npm run dev -- --host 127.0.0.1`
- Browser: Playwright bundled Chromium
- Scratch fixtures copied to: `/tmp/antigravity-pdf-ui-fixtures`
- Generated screenshots/logs: `output/playwright/`
- Dev server and browser sessions were stopped after the pass.

## Fixture Set

Fixtures were copied from the local university folder so tests covered normal
slides, low-text documents, garbled/sparse text layers, and a large book.

- `db_book_665p_sparse_text.pdf`: 665-page database book, useful for large
  document rendering, virtualization, minimap, and garbled text testing.
- `db_chapter04_50p_text.pdf`: database chapter with native text.
- `oop_gui_db_usecases_62p_slides.pdf`: mixed lecture-slide workflow fixture.
- `stats_note_27p_low_text.pdf`: low-text/scan-like detection fixture.
- `os_intro_17p_wide_slides.pdf`: wide slide and zoom/layout fixture.

Large or copyrighted fixtures should not be committed. Keep local fixture
recipes or paths in docs, and commit only minimal license-safe synthetic PDFs.

## Agent Coverage

- Onboarding/upload flow: file picker, drag/drop, first render, basic
  navigation.
- Large-document flow: 665-page import, direct jump, minimap, sidebar
  virtualization, memory/jank observations.
- OCR/text-layer flow: scanned-page detection, single-page OCR, Clean OCR
  failure state in browser mode, garbled native text.
- Batch/range/export flow: range parser behavior, select/remove/keep/export
  affordances, mixed valid/invalid input.
- UX polish/accessibility flow: desktop layout, narrow layout, icon labels,
  zoom defaults, destructive actions.

## High Priority Findings

- Mixed valid and invalid ranges, such as `1-3,9999`, show an error but still
  enable mutating/export actions. Actions apply only the valid subset, which is
  unsafe.
- Minimap click math jumps to the wrong page after the minimap itself has
  scrolled.
- Upload control is not keyboard reachable.
- Virtualized drag/reorder triggers `@hello-pangea/dnd` invariant errors and
  can leave unstable ordering behavior.
- Destructive actions run without confirmation or undo.

## Medium Priority Findings

- Large document import has no progress UI and analyzes all pages before the
  editor becomes useful.
- Direct page jumps render the requested page but do not sync the active
  thumbnail/minimap viewport.
- Rapid sidebar scrolling on large PDFs shows jank and memory growth.
- Invert selection appears to be a no-op.
- Default 150% zoom crops wide slides.
- Floating page/zoom controls can cover document content.
- OCR overlay/text quality can be poor even when OCR completes.
- OCR completion can leave stale "needs OCR" sidebar badges.
- Scan detection misses some low-text/scan-like PDFs.
- Icon-only controls are missing accessible names.
- Clean OCR fails gracefully in browser mode but reveals the native bridge is
  not abstracted cleanly enough.

## Behaviors Confirmed Working

- Click upload and drag/drop upload work.
- Multi-document add/merge flow works.
- Full export and range export worked for tested fixtures.
- The 665-page document can load and render on the test machine.
- Direct page jumps are fast after a large document has loaded.
- Keyboard page navigation, zoom, and pan work.
- Single-page OCR completes without crashing.

## Useful Artifacts

- `output/playwright/onboarding/loaded-page1.png`
- `output/playwright/large-doc/minimap-click-from-bottom.png`
- `output/playwright/large-doc/direct-jump-333.png`
- `output/playwright/ocr/08-clean-ocr-failure-state.png`
- `output/playwright/batch-range/16-range-mixed-1-3-9999-actions-enabled.png`
- `output/playwright/responsive/mobile-editor-text-chromium.png`

## Verification Recommendations

- Add unit tests for range parsing and range-action gating.
- Add unit tests for pure page operations and selected-block reorder.
- Add unit tests for minimap viewport and click math, including internal scroll.
- Add OCR state transition tests for single, selected, batch, cancel, retry,
  and partial completion.
- Add Playwright desktop smoke tests for upload, large-doc jump, minimap click,
  range invalid gating, export, OCR state, and reorder.
- Add package-mode or Electron-mode tests for Clean OCR native bridge behavior.

## Batch 1 Regression Suite

Added on 2026-07-02:

- `playwright.config.ts`
- `tests/playwright/batch1-stabilization.spec.ts`
- `playwright.packaged.config.ts`
- `tests/packaged/batch1-packaged.spec.ts`

Coverage:

- mixed valid/invalid range actions remain disabled;
- direct page jumps keep the active sidebar thumbnail synchronized;
- scrolled minimap clicks target the expected page;
- destructive range removal requires custom confirmation and can be undone;
- range Keep Only requires custom confirmation and can be undone;
- thumbnail single-page removal requires custom confirmation and can be undone;
- selected-page removal requires custom confirmation and can be undone;
- Start Over requires custom confirmation and can be undone from the upload
  screen;
- undo expires after the short-lived undo window;
- successful sidebar drag reorders pages and can be undone;
- canceled sidebar drag preserves order and emits no drag invariant errors.

Packaged smoke coverage:

- launches the built unpacked Electron app;
- opens real PDF fixtures from the packaged app;
- verifies invalid mixed range actions remain disabled in packaged mode;
- verifies destructive Remove confirmation and undo in packaged mode;
- verifies direct page jump/sidebar sync in packaged mode.

## Batch 2 And 3 Regression Additions

Added on 2026-07-02:

- `tests/playwright/batch2-import-progress.spec.ts`
- `tests/playwright/batch3-ocr-job.spec.ts`

Coverage:

- large imports publish page count and render page 1 while analysis continues;
- Start Over during import cancels stale work;
- Add PDFs to Merge shows import progress and appends pages;
- selected scanned pages start a context OCR job;
- OCR cancellation marks queued/running pages skipped.
