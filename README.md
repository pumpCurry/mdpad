➡[Japanese 🇯🇵](./README.ja.md).
# mdpad
A GitHub-flavored Markdown editor built as a Windows standalone desktop application. Edit, preview, and diff your Markdown files with a clean, multi-pane interface.

![mdpad Editor and Preview](docs/resources/02_edit_preview_en.png)

## Features

- **Multi-pane layout** -- switch between Editor, Preview, and Diff views (1-3 panes)
- **GitHub-flavored Markdown** -- full GFM rendering with task lists and footnotes
- **Mermaid diagrams** -- render flowcharts, sequence diagrams, and more
- **KaTeX math** -- inline and display math expressions
- **Syntax-highlighted code blocks** -- powered by highlight.js
- **Search and replace** -- in-editor find with match count display
- **Global search** -- cross-pane search across editor and preview
- **Drag-and-drop** -- open files by dropping them onto the window
- **Autosave backup** -- configurable timer with automatic backup
- **Crash recovery** -- restore your work after unexpected exits
- **Internationalization** -- English and Japanese (en/ja)

## Installation

### Portable (recommended)

1. Download the latest `.zip` from [Releases](../../releases).
2. Extract to any folder.
3. Run `mdpad.exe`.

No installation required.

### Build from source

See the [Development](#development) section below.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New file |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+F` | Find |
| `Ctrl+H` | Replace |
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` | Toggle panes |
| `Alt+Z` | Word wrap |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl++` / `Ctrl+-` | Zoom in / out |
| `Ctrl+0` | Reset zoom |
| `F12` | DevTools |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- npm

### Setup

```bash
git clone https://github.com/pumpCurry/mdpad.git
cd mdpad
npm install
```

### Run

```bash
npm start
```

For development mode with DevTools:

```bash
npm run dev
```

### Build

Build a portable directory:

```bash
npm run build
```

Build and create a zip archive:

```bash
npm run build:zip
```

## Tech Stack

| Component | Library | License |
|---|---|---|
| Application framework | Electron | MIT |
| Code editor | CodeMirror 6 | MIT |
| Markdown parser | markdown-it | MIT |
| Diagrams | Mermaid | MIT |
| Math rendering | KaTeX | MIT |
| Syntax highlighting | highlight.js | BSD-3-Clause |
| Diff engine | jsdiff | BSD-3-Clause |
| HTML sanitizer | DOMPurify | Apache-2.0 / MPL-2.0 |
| Markdown styles | github-markdown-css | MIT |
| Bundler | esbuild | MIT |
| Packager | electron-builder | MIT |

## Third-party Licenses

This project uses the following open-source libraries:

- **Electron** -- MIT License
- **CodeMirror 6** -- MIT License
- **markdown-it** -- MIT License
- **Mermaid** -- MIT License
- **KaTeX** -- MIT License
- **highlight.js** -- BSD-3-Clause License
- **jsdiff** -- BSD-3-Clause License
- **DOMPurify** -- Apache-2.0 / MPL-2.0 License
- **github-markdown-css** -- MIT License
- **esbuild** -- MIT License
- **electron-builder** -- MIT License

## Documentation

- [User Guide](docs/en/how_to_use.md)

## License

MIT License. See [LICENSE](LICENSE) for details.

(C) pumpCurry, 5r4ce2
