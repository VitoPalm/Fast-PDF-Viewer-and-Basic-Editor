# 🖋️ Antigravity PDF

A premium, high-performance web-based PDF editor built with React, Vite, and PDF.js. Designed with a sleek glassmorphism aesthetic and optimized for handling massive documents with ease.

![PDF Editor Preview](https://raw.githubusercontent.com/VitoPalm/Fast-PDF-Viewer-and-Basic-Editor/main/src/assets/hero.png)

## ✨ Key Features

- **🚀 High-Performance Rendering**: Leveraging Web Workers and a custom LRU bitmap cache for buttery-smooth scrolling, even with 600+ page documents.
- **🛠️ Advanced Manipulation**: Merge multiple PDFs, split documents, extract specific chapters, and reorder pages with simple drag-and-drop or batch actions.
- **🔍 Document Minimap**: A visual overview of your entire document for rapid navigation.
- **🎞️ Animated Filmstrip**: Interactive page previews with multi-select support and batch operations.
- **⚡ Page Range Engine**: A powerful command-driven system to perform complex operations on specific page ranges (e.g., `1-5, 12, 50-end`).
- **🎨 Premium UI**: Modern glassmorphism design system using vanilla CSS for maximum performance and a professional look.

## 🛠️ Tech Stack

- **Framework**: [React 18](https://reactjs.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **PDF Logic**: [PDF.js](https://mozilla.github.io/pdf.js/) & [pdf-lib](https://pdf-lib.js.org/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Styling**: Vanilla CSS (Custom Design System)

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

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

3. Start the development server:
   ```bash
   npm run dev
   ```

## 📖 How to Use

1. **Upload**: Drag and drop your PDF files into the main workspace.
2. **Organize**: Use the sidebar to reorder pages or select specific pages for batch actions.
3. **Edit**: Use the Page Range bar to quickly isolate or manipulate sections of the document.
4. **Export**: Click the "Export PDF" button to download your modified document.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

Built with ❤️ by [VitoPalm](https://github.com/VitoPalm)
