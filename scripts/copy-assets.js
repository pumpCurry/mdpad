const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist", "renderer");
fs.mkdirSync(distDir, { recursive: true });

// Copy KaTeX CSS and fonts
const katexDist = path.join(__dirname, "..", "node_modules", "katex", "dist");
const katexDestDir = path.join(distDir, "katex");
fs.mkdirSync(katexDestDir, { recursive: true });
fs.copyFileSync(
  path.join(katexDist, "katex.min.css"),
  path.join(katexDestDir, "katex.min.css")
);

const fontsSource = path.join(katexDist, "fonts");
const fontsDest = path.join(katexDestDir, "fonts");
fs.mkdirSync(fontsDest, { recursive: true });
for (const f of fs.readdirSync(fontsSource)) {
  if (f.endsWith(".woff2") || f.endsWith(".woff") || f.endsWith(".ttf")) {
    fs.copyFileSync(path.join(fontsSource, f), path.join(fontsDest, f));
  }
}

// Copy highlight.js theme CSS
const hljsStyles = path.join(
  __dirname,
  "..",
  "node_modules",
  "highlight.js",
  "styles"
);
const hljsDest = path.join(distDir, "hljs");
fs.mkdirSync(hljsDest, { recursive: true });
fs.copyFileSync(
  path.join(hljsStyles, "github.min.css"),
  path.join(hljsDest, "github.min.css")
);
fs.copyFileSync(
  path.join(hljsStyles, "github-dark.min.css"),
  path.join(hljsDest, "github-dark.min.css")
);

// Copy github-markdown-css
const ghMdCss = path.join(
  __dirname,
  "..",
  "node_modules",
  "github-markdown-css",
  "github-markdown.css"
);
fs.copyFileSync(ghMdCss, path.join(distDir, "github-markdown.css"));

console.log("Assets copied successfully.");
