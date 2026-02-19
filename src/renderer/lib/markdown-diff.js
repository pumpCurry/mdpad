/**
 * Markdown-level rich diff: renders the diff as a GitHub-style
 * rich diff preview where added/removed content is shown inline
 * in the rendered Markdown with green/red highlights.
 */
import { diffLines, diffWords } from "diff";
import { renderMarkdown } from "./markdown-engine.js";

/**
 * Generate a rich Markdown diff HTML.
 * Approach: compute line-level diff, then render each chunk
 * with appropriate CSS classes wrapping the rendered markdown.
 */
export function renderMarkdownDiff(oldText, newText) {
  if (oldText === newText) {
    return '<div class="md-diff-empty">No changes</div>';
  }

  const lineDiffs = diffLines(oldText, newText);
  let html = '';

  for (const part of lineDiffs) {
    const text = part.value;
    if (!text.trim() && !text.includes('\n')) continue;

    const rendered = renderMarkdown(text);

    if (part.added) {
      html += `<div class="md-diff-added">${rendered}</div>`;
    } else if (part.removed) {
      html += `<div class="md-diff-removed">${rendered}</div>`;
    } else {
      html += `<div class="md-diff-unchanged">${rendered}</div>`;
    }
  }

  return html;
}

/**
 * Generate a word-level inline rich diff for smaller documents.
 * Shows the old (deleted) words with strikethrough/red and
 * new (added) words with green highlight, all within rendered context.
 *
 * This approach merges old and new text with diff markers,
 * then renders the combined Markdown.
 */
export function renderMarkdownDiffInline(oldText, newText) {
  if (oldText === newText) {
    return '<div class="md-diff-empty">No changes</div>';
  }

  // Line-by-line diff, then word-level within changed lines
  const lineDiffs = diffLines(oldText, newText);
  let mergedLines = [];

  for (let i = 0; i < lineDiffs.length; i++) {
    const part = lineDiffs[i];

    if (!part.added && !part.removed) {
      // Unchanged lines pass through
      mergedLines.push(part.value);
    } else if (part.removed) {
      // Check if next part is added (a replacement)
      const next = lineDiffs[i + 1];
      if (next && next.added) {
        // Word-level diff between removed and added
        const wordDiffs = diffWords(part.value, next.value);
        let merged = '';
        for (const w of wordDiffs) {
          if (w.removed) {
            merged += `<span class="md-diff-word-removed">${escapeHtml(w.value)}</span>`;
          } else if (w.added) {
            merged += `<span class="md-diff-word-added">${escapeHtml(w.value)}</span>`;
          } else {
            merged += escapeHtml(w.value);
          }
        }
        mergedLines.push(merged);
        i++; // skip the next (added) part
      } else {
        // Pure deletion
        mergedLines.push(`<span class="md-diff-word-removed">${escapeHtml(part.value)}</span>`);
      }
    } else if (part.added) {
      // Pure addition (no preceding removal)
      mergedLines.push(`<span class="md-diff-word-added">${escapeHtml(part.value)}</span>`);
    }
  }

  // The merged result contains HTML spans mixed with raw text.
  // We render it as HTML directly (not through markdown-it, since we already have markers)
  const combined = mergedLines.join('');
  return `<div class="md-diff-inline-view">${combined}</div>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}
