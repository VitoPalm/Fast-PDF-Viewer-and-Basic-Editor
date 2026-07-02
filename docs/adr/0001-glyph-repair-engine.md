# ADR 0001: Glyph Repair Engine

Status: accepted for Phase 4C/4D guarded repair

Date: 2026-07-02

## Context

Antigravity PDF needs to repair PDFs that render correctly but copy/search
incorrectly because font character codes map to the wrong Unicode values. The
preferred repair path is adding or replacing `/ToUnicode` CMaps while preserving
the original vector artwork.

The existing renderer stack can detect suspect text layers with PDF.js, but
PDF.js does not expose a stable public API for full glyph-event and font-program
repair. `pdf-lib` can write low-level PDF objects, but it is not a strong fit
for content-stream glyph analysis or embedded font internals.

## Decision

Use an Apache PDFBox/FontBox Java sidecar as the primary native glyph analysis
and repair engine.

Phase 4A shipped diagnostics:

- parse selected pages with `PDFStreamEngine`;
- record font metadata, raw character codes, current Unicode mapping, rendering
  mode, displacement, and text matrix positions;
- classify fonts as mapping-present, deterministic `/ToUnicode` candidates,
  existing-map review candidates, or OCR-assisted mapping candidates;
- return JSON through the typed Electron bridge.

Phase 4B adds conservative mutation:

- generate `/ToUnicode` streams for fonts without existing maps when every
  observed character code has a deterministic Unicode value;
- skip encrypted, signed, damaged, vertical, existing-map, and ambiguous cases;
- validate by reloading the repaired PDF, rendering selected pages, and
  comparing pixel output before handing bytes back to the renderer.

Phase 4C/4D adds guarded expansion:

- replacement of existing `/ToUnicode` maps only when explicitly requested;
- strict OCR-assisted mapping from supplied OCR text when glyph events and text
  codepoints align exactly and consistently;
- selected/suspect page batch repair in the renderer using the page-level repair
  path.

The renderer remains responsible for user workflow, page replacement, job
state, and status UI. Geometric OCR alignment and human review remain later
phases.

## Consequences

- Java and Maven are now build-time requirements.
- Packaged builds include a shaded `glyph-repair.jar` resource.
- A future release should bundle or locate a Java runtime instead of assuming
  `java` exists on the user's machine.
- `qpdf` and an independent extractor/renderer should be added to CI validation
  before broader batch repair ships.
- OCR-assisted repair intentionally skips low-confidence alignments; this avoids
  silently corrupting selectable text while the alignment engine is still
  conservative.
