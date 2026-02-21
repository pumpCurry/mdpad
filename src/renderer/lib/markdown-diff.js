/**
 * Markdown-level rich diff: renders the diff as a GitHub-style
 * rich diff preview where added/removed content is shown inline
 * in the rendered Markdown with green/red highlights.
 *
 * Uses block-level diffing to preserve multi-line structures
 * (tables, fenced code blocks, Mermaid diagrams, lists, etc.)
 */
import { diffArrays } from "diff";
import { renderMarkdown } from "./markdown-engine.js";

/**
 * Split a Markdown string into an array of self-contained block strings.
 *
 * Block boundaries:
 * - Fenced code blocks (``` or ~~~, including mermaid): opening → closing = 1 block
 * - Table rows: contiguous lines starting with | = 1 block
 * - Block quotes: contiguous lines starting with > = 1 block
 * - Lists: contiguous lines starting with - / * / + / 1. (incl. indented continuation) = 1 block
 * - Paragraphs: separated by blank lines = 1 block each
 */
function splitIntoBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let current = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  function flush() {
    if (current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Fenced code blocks ---
    if (!inFence) {
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        flush();
        inFence = true;
        fenceChar = fenceMatch[1][0];
        fenceLen = fenceMatch[1].length;
        current.push(line);
        continue;
      }
    } else {
      current.push(line);
      // Check for closing fence: same char, at least same length, only whitespace after
      const closeRegex = new RegExp(
        "^" + (fenceChar === "`" ? "`" : "~") + "{" + fenceLen + ",}\\s*$"
      );
      if (closeRegex.test(line)) {
        inFence = false;
        fenceChar = "";
        fenceLen = 0;
        flush();
      }
      continue;
    }

    // --- Blank line = block boundary ---
    if (line.trim() === "") {
      flush();
      continue;
    }

    // --- Classify line type ---
    const isTableRow = /^\|/.test(line);
    const isBlockQuote = /^>/.test(line);
    const isListItem = /^(\s*[-*+]|\s*\d+[.)]\s)/.test(line);
    const isIndented = /^\s+\S/.test(line); // indented continuation

    if (current.length > 0) {
      const prevLine = current[current.length - 1];
      const prevIsTable = /^\|/.test(prevLine);
      const prevIsBlockQuote = /^>/.test(prevLine);
      const prevIsList = /^(\s*[-*+]|\s*\d+[.)]\s)/.test(prevLine) ||
                         (/^\s+\S/.test(prevLine) && current.length >= 2);

      // Keep table rows together
      if (isTableRow && prevIsTable) {
        current.push(line);
        continue;
      }
      // Keep block quote lines together
      if (isBlockQuote && prevIsBlockQuote) {
        current.push(line);
        continue;
      }
      // Keep list items together (including indented continuations)
      if (prevIsList && (isListItem || isIndented)) {
        current.push(line);
        continue;
      }
      // If type changes, flush and start new block
      if (
        (isTableRow && !prevIsTable) ||
        (isBlockQuote && !prevIsBlockQuote) ||
        (prevIsTable && !isTableRow) ||
        (prevIsBlockQuote && !isBlockQuote)
      ) {
        flush();
        current.push(line);
        continue;
      }
    }

    current.push(line);
  }

  // Flush remaining (including unclosed fences)
  flush();

  return blocks;
}

/**
 * Generate a rich Markdown diff HTML.
 * Uses block-level diffing: splits both texts into semantic blocks,
 * diffs at block level, then renders each complete block.
 */
export function renderMarkdownDiff(oldText, newText) {
  if (oldText === newText) {
    return '<div class="md-diff-empty">No changes</div>';
  }

  const oldBlocks = splitIntoBlocks(oldText);
  const newBlocks = splitIntoBlocks(newText);
  const blockDiffs = diffArrays(oldBlocks, newBlocks);

  let html = "";

  for (const part of blockDiffs) {
    for (const block of part.value) {
      const rendered = renderMarkdown(block);

      if (part.added) {
        html += `<div class="md-diff-added">${rendered}</div>`;
      } else if (part.removed) {
        html += `<div class="md-diff-removed">${rendered}</div>`;
      } else {
        html += `<div class="md-diff-unchanged">${rendered}</div>`;
      }
    }
  }

  return html;
}

/**
 * Generate a word-level inline rich diff.
 * Uses block-level diffing, then for replacement pairs (removed→added),
 * interleaves removed/added blocks for visual comparison.
 */
export function renderMarkdownDiffInline(oldText, newText) {
  if (oldText === newText) {
    return '<div class="md-diff-empty">No changes</div>';
  }

  const oldBlocks = splitIntoBlocks(oldText);
  const newBlocks = splitIntoBlocks(newText);
  const blockDiffs = diffArrays(oldBlocks, newBlocks);

  let html = "";

  for (let i = 0; i < blockDiffs.length; i++) {
    const part = blockDiffs[i];

    if (!part.added && !part.removed) {
      // Unchanged blocks
      for (const block of part.value) {
        html += `<div class="md-diff-unchanged">${renderMarkdown(block)}</div>`;
      }
    } else if (part.removed) {
      // Check if next part is added (replacement pair)
      const next = blockDiffs[i + 1];
      if (next && next.added) {
        // Interleave removed/added blocks
        const maxLen = Math.max(part.value.length, next.value.length);
        for (let j = 0; j < maxLen; j++) {
          if (j < part.value.length) {
            html += `<div class="md-diff-removed">${renderMarkdown(part.value[j])}</div>`;
          }
          if (j < next.value.length) {
            html += `<div class="md-diff-added">${renderMarkdown(next.value[j])}</div>`;
          }
        }
        i++; // skip the added part
      } else {
        // Pure deletion
        for (const block of part.value) {
          html += `<div class="md-diff-removed">${renderMarkdown(block)}</div>`;
        }
      }
    } else if (part.added) {
      // Pure addition (no preceding removal)
      for (const block of part.value) {
        html += `<div class="md-diff-added">${renderMarkdown(block)}</div>`;
      }
    }
  }

  return `<div class="md-diff-inline-view">${html}</div>`;
}
