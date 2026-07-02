# Third-Party Notices

Antigravity PDF includes third-party open source components. Each dependency
retains its own license terms.

## GhostPDL / Ghostscript

Clean OCR packages GhostPDL/Ghostscript WebAssembly through
`@okathira/ghostpdl-wasm`.

- Package: `@okathira/ghostpdl-wasm`
- License: AGPL-3.0-or-later
- Upstream project: https://github.com/ArtifexSoftware/ghostpdl
- Packaged artifact: `gs.wasm`

Anyone distributing builds that include Clean OCR must satisfy the
AGPL-3.0-or-later obligations for this component.

## PDFBox

Text diagnostics and text repair use a Java sidecar built on Apache PDFBox.

- Package: `org.apache.pdfbox:pdfbox`
- License: Apache-2.0
- Upstream project: https://pdfbox.apache.org/
- Packaged artifact: `glyph-repair.jar`
