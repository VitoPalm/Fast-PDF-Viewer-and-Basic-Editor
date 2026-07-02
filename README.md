# 🖋️ Antigravity PDF

### The High-Performance Desktop PDF Powerhouse

Antigravity PDF is a premium, professional-grade PDF viewer and editor designed for speed, beauty, and massive documents. Built with **Electron**, **React**, and a custom-engineered rendering pipeline, it brings a buttery-smooth web experience to the desktop.

> [!TIP]
> **Looking for a ready-to-use version?** You can download the latest pre-built binaries for Windows, macOS, and Linux from the [GitHub Releases](https://github.com/VitoPalm/Fast-PDF-Viewer-and-Basic-Editor/releases) page.

![Antigravity PDF Mockup](https://raw.githubusercontent.com/VitoPalm/Fast-PDF-Viewer-and-Basic-Editor/main/src/assets/hero.png)

## ✨ Key Features

- **🚀 Pro-Grade Rendering Engine**: Leverages a multi-threaded rendering pipeline using `ImageBitmap` and `requestIdleCallback` to ensure the UI remains responsive even when processing complex pages.
- **🧠 Dual-Layer LRU Cache**: Intelligent memory management with separate caches for high-speed thumbnail browsing (250+ pages) and high-resolution viewports.
- **🎨 Glassmorphism Design**: A stunning, modern interface built with vanilla CSS, featuring vibrant gradients, subtle blurs, and micro-animations.
- **⚡ Page Range Engine**: Perform complex batch operations (Delete, Extract, Reorder) using a powerful command syntax (e.g., `1-5, 12, 50-end`).
- **🎞️ Interactive Filmstrip**: A virtualized sidebar for rapid navigation and multi-select page manipulation.
- **🧠 Intelligent OCR**: Automated scan detection and high-performance text recognition using Tesseract.js. Features a batch processing pipeline that automatically flattens pages with existing text before re-scanning, and a dual-container text layer that cleanly separates native PDF text from OCR-generated overlays.
- **🛠️ Advanced Editing**: Add text annotations, merge multiple documents, and reorder pages with intuitive drag-and-drop.

## 🏗️ Technical Architecture

Antigravity PDF is built on a modern, decoupled architecture designed for performance:

- **Electron (Main Process)**: Handles native window management, file system access, and system-level integrations.
- **React (Renderer Process)**: Powering a highly reactive UI with a custom state management system for PDF metadata.
- **PDF.js Core**: Utilized for low-level document parsing and page rendering via Web Workers.
- **PDF-Lib**: Orchestrates complex document mutations (splitting, merging, saving) with high fidelity.

### The Rendering Pipeline
1. **Request Queue**: Pages are requested with different priorities (`urgent` for the current view, `low` for preloading).
2. **Worker Rendering**: PDF.js renders the page to a background canvas.
3. **Bitmap Conversion**: The canvas is converted to an `ImageBitmap` to minimize main-thread transfer costs.
4. **LRU Eviction**: Off-screen bitmaps are automatically evicted from memory based on usage patterns to prevent memory leaks.

## 🛠️ Tech Stack

- **Runtime**: [Electron](https://www.electronjs.org/)
- **Frontend**: [React 19](https://reactjs.org/) & [Vite](https://vitejs.dev/)
- **PDF Logic**: [PDF.js](https://mozilla.github.io/pdf.js/) & [pdf-lib](https://pdf-lib.js.org/)
- **Styling**: Vanilla CSS (Custom Design System)
- **Icons**: [Lucide React](https://lucide.dev/)
- **D&D**: [@hello-pangea/dnd](https://github.com/hello-pangea/dnd)

## 🚀 Getting Started

### Prerequisites
- Node.js 22.12.0 or higher
- npm
- Java 21 or higher and Maven, required to build the PDFBox glyph diagnostics sidecar
- Java 21 or higher at runtime for packaged text checks and text repair, unless the build is changed to bundle a Java runtime

### Runtime Notes
- Clean OCR bundles GhostPDL/Ghostscript through `@okathira/ghostpdl-wasm`, which is licensed under AGPL-3.0-or-later.
- OCR language data and some PDF.js CMap/standard-font resources are still loaded from dependency-managed network URLs; fully offline packaging remains follow-up work.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/VitoPalm/Fast-PDF-Viewer-and-Basic-Editor.git
   cd Fast-PDF-Viewer-and-Basic-Editor
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development environment:
   ```bash
   npm run dev
   ```

## 📦 Build & Distribution

Antigravity PDF is ready for cross-platform distribution. You can find pre-built binaries on the [Releases](https://github.com/VitoPalm/Fast-PDF-Viewer-and-Basic-Editor/releases) page, or generate your own installers using the following commands:

- **Windows**: `npm run electron:build:win`
- **macOS**: `npm run electron:build:mac`
- **Linux**: `npm run electron:build:linux`

Artifacts will be generated in the `release/` directory.

## 📂 Project Structure

```text
├── electron/          # Main process and preload scripts
├── src/
│   ├── features/      # Feature-specific modules (Workspace, Sidebar, PDF Engine)
│   ├── shared/        # Shared hooks, utils, and global types
│   ├── context/       # Global state management
│   ├── styles/        # Global styles and design system tokens
│   └── assets/        # Static assets (images)
├── public/            # Static assets and worker scripts
└── vite.config.ts     # Build configuration
```

## 📄 License

This project does not currently publish a single permissive project license. Distributed builds include `@okathira/ghostpdl-wasm`/GhostPDL components under AGPL-3.0-or-later for Clean OCR, and all third-party dependencies retain their own licenses. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

---

Built with ❤️ by [VitoPalm](https://github.com/VitoPalm)
