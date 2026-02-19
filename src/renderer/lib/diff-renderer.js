/**
 * Render diff results into HTML.
 * Supports side-by-side and inline (unified) views.
 */

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderWordDiffs(wordDiffs, side) {
  if (!wordDiffs) return null;
  let html = "";
  for (const part of wordDiffs) {
    const escaped = escapeHtml(part.value);
    if (part.added) {
      if (side === "new") {
        html += `<span class="diff-word-added">${escaped}</span>`;
      }
      // Skip added parts on old side
    } else if (part.removed) {
      if (side === "old") {
        html += `<span class="diff-word-removed">${escaped}</span>`;
      }
      // Skip removed parts on new side
    } else {
      html += escaped;
    }
  }
  return html;
}

export function renderInlineDiff(diffResult) {
  let html = '<div class="diff-inline">';

  for (const entry of diffResult) {
    const lineContent = entry.lines[0];
    let cssClass = "";
    let prefix = " ";
    let lineNum = "";

    if (entry.type === "added") {
      cssClass = "added";
      prefix = "+";
      lineNum = String(entry.newLine);
    } else if (entry.type === "removed") {
      cssClass = "removed";
      prefix = "-";
      lineNum = String(entry.oldLine);
    } else {
      cssClass = "unchanged";
      lineNum = String(entry.oldLine);
    }

    let contentHtml;
    if (entry.wordDiffs) {
      const side = entry.type === "removed" ? "old" : "new";
      contentHtml = renderWordDiffs(entry.wordDiffs, side);
    } else {
      contentHtml = escapeHtml(lineContent);
    }

    html += `<div class="diff-line ${cssClass}">`;
    html += `<span class="diff-line-number">${lineNum}</span>`;
    html += `<span class="diff-line-content">${prefix} ${contentHtml}</span>`;
    html += `</div>`;
  }

  html += "</div>";
  return html;
}

export function renderSideBySideDiff(diffResult) {
  let leftHtml = "";
  let rightHtml = "";

  for (const entry of diffResult) {
    const lineContent = entry.lines[0];

    if (entry.type === "unchanged") {
      const escaped = escapeHtml(lineContent);
      leftHtml += `<div class="diff-line unchanged">`;
      leftHtml += `<span class="diff-line-number">${entry.oldLine}</span>`;
      leftHtml += `<span class="diff-line-content">${escaped}</span></div>`;

      rightHtml += `<div class="diff-line unchanged">`;
      rightHtml += `<span class="diff-line-number">${entry.newLine}</span>`;
      rightHtml += `<span class="diff-line-content">${escaped}</span></div>`;
    } else if (entry.type === "removed") {
      let contentHtml;
      if (entry.wordDiffs) {
        contentHtml = renderWordDiffs(entry.wordDiffs, "old");
      } else {
        contentHtml = escapeHtml(lineContent);
      }
      leftHtml += `<div class="diff-line removed">`;
      leftHtml += `<span class="diff-line-number">${entry.oldLine}</span>`;
      leftHtml += `<span class="diff-line-content">${contentHtml}</span></div>`;

      // Empty line on right side if next isn't added
      rightHtml += `<div class="diff-line removed">`;
      rightHtml += `<span class="diff-line-number"></span>`;
      rightHtml += `<span class="diff-line-content"></span></div>`;
    } else if (entry.type === "added") {
      let contentHtml;
      if (entry.wordDiffs) {
        contentHtml = renderWordDiffs(entry.wordDiffs, "new");
      } else {
        contentHtml = escapeHtml(lineContent);
      }
      // Check if previous was removed with word diffs (paired)
      leftHtml += `<div class="diff-line added">`;
      leftHtml += `<span class="diff-line-number"></span>`;
      leftHtml += `<span class="diff-line-content"></span></div>`;

      rightHtml += `<div class="diff-line added">`;
      rightHtml += `<span class="diff-line-number">${entry.newLine}</span>`;
      rightHtml += `<span class="diff-line-content">${contentHtml}</span></div>`;
    }
  }

  return `<div class="diff-side-by-side">
    <div class="diff-column">${leftHtml}</div>
    <div class="diff-column">${rightHtml}</div>
  </div>`;
}
