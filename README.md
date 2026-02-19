# mdpad

GitHub-flavored Markdown editor with live preview and diff.

Windows standalone desktop application.

## Features

- **Editor** - CodeMirror 6 based editor with Markdown syntax highlighting, line numbers, code folding, rectangular selection (Alt+drag), search & replace with regex
- **Live Preview** - Real-time GitHub-flavored Markdown rendering
  - Tables, task lists, footnotes (GFM)
  - Mermaid diagrams
  - KaTeX math expressions (`$...$`, `$$...$$`)
  - Syntax-highlighted code blocks (highlight.js)
  - Scroll sync with editor
- **Diff View** - Side-by-side or inline diff
  - Edit history mode (vs. file open state)
  - File compare mode (vs. external file)
  - Rich Markdown diff in preview pane
- **Flexible Layout** - 1-3 pane layout, freely combinable
  - Ctrl+1 / Ctrl+2 / Ctrl+3 to toggle each pane
  - Resizable pane dividers
- **Cross-pane Search** - Search across editor, preview, and diff simultaneously with hit count display
- **Auto Backup** - Configurable autosave timer (1-60 min or OFF)
  - Crash recovery with diff-safe backup (preserves original content for diff)
  - Multi-instance safe (PID-based)
- **i18n** - English / Japanese, auto-detects OS locale
- **Close Protection** - Save confirmation dialog with context-sensitive options

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New file |
| Ctrl+O | Open file |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+F | Find |
| Ctrl+H | Replace |
| Ctrl+1 | Toggle Editor pane |
| Ctrl+2 | Toggle Preview pane |
| Ctrl+3 | Toggle Diff pane |
| Alt+Z | Toggle word wrap |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl++/- | Zoom in/out |
| Ctrl+0 | Reset zoom |
| F12 | Developer tools |

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Run (development)

```bash
npm start
```

### Build (portable exe)

```bash
npm run build
```

The output will be in `build/win-unpacked/`. To create a portable zip:

```bash
npm run build:zip
```

This creates `build/mdpad-v1.0.0-win-x64-portable.zip`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Electron |
| Editor | CodeMirror 6 |
| Markdown | markdown-it + plugins |
| Diagrams | Mermaid |
| Math | KaTeX |
| Code Highlight | highlight.js |
| Diff | jsdiff |
| Sanitizer | DOMPurify |
| Bundler | esbuild |
| Build | electron-builder |

## License

MIT License - (C) pumpCurry, 5r4ce2

See [LICENSE](LICENSE) for details.
