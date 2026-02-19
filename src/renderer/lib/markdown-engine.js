import markdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js";

// Source line mapping plugin: injects data-source-line attributes
function sourceLinePlugin(md) {
  const defaultRender =
    md.renderer.rules.paragraph_open ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

  const blockTypes = [
    "paragraph_open",
    "heading_open",
    "blockquote_open",
    "bullet_list_open",
    "ordered_list_open",
    "table_open",
    "hr",
    "code_block",
    "fence",
    "html_block",
  ];

  for (const type of blockTypes) {
    const original =
      md.renderer.rules[type] ||
      function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

    md.renderer.rules[type] = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      if (token.map && token.map.length) {
        token.attrSet("data-source-line", String(token.map[0]));
      }
      return original(tokens, idx, options, env, self);
    };
  }
}

const md = markdownIt({
  html: true,
  linkify: true,
  typographer: false,
  highlight: (str, lang) => {
    if (lang === "mermaid") {
      // Return raw code for Mermaid post-processing
      return `<code class="language-mermaid">${md.utils.escapeHtml(str)}</code>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true })
          .value;
      } catch {
        // fallthrough
      }
    }
    // Auto-detection fallback
    try {
      return hljs.highlightAuto(str).value;
    } catch {
      return "";
    }
  },
})
  .use(footnote)
  .use(taskLists, { enabled: true, label: true })
  .use(texmath, { engine: katex, delimiters: "dollars" })
  .use(sourceLinePlugin);

export function renderMarkdown(source) {
  return md.render(source);
}
