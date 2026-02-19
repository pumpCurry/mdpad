import { diffLines, diffWords } from "diff";

/**
 * Compute a line-level diff between two texts.
 * Returns an array of diff hunks with word-level detail for changed lines.
 */
export function computeDiff(oldText, newText) {
  const lineDiffs = diffLines(oldText, newText);
  const result = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const part of lineDiffs) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (part.value === "" || (lines.length === 1 && lines[0] === "" && part.value === "\n")) {
      // Handle edge case of trailing newline
      if (part.added) {
        result.push({ type: "added", lines: [""], oldLine: null, newLine: newLineNum });
        newLineNum++;
      } else if (part.removed) {
        result.push({ type: "removed", lines: [""], oldLine: oldLineNum, newLine: null });
        oldLineNum++;
      } else {
        result.push({ type: "unchanged", lines: [""], oldLine: oldLineNum, newLine: newLineNum });
        oldLineNum++;
        newLineNum++;
      }
      continue;
    }

    for (const line of lines) {
      if (part.added) {
        result.push({
          type: "added",
          lines: [line],
          oldLine: null,
          newLine: newLineNum,
        });
        newLineNum++;
      } else if (part.removed) {
        result.push({
          type: "removed",
          lines: [line],
          oldLine: oldLineNum,
          newLine: null,
        });
        oldLineNum++;
      } else {
        result.push({
          type: "unchanged",
          lines: [line],
          oldLine: oldLineNum,
          newLine: newLineNum,
        });
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  return addWordLevelDiffs(result);
}

/**
 * For adjacent removed/added pairs, compute word-level diffs
 */
function addWordLevelDiffs(diffResult) {
  for (let i = 0; i < diffResult.length - 1; i++) {
    if (
      diffResult[i].type === "removed" &&
      diffResult[i + 1].type === "added"
    ) {
      const oldLine = diffResult[i].lines[0];
      const newLine = diffResult[i + 1].lines[0];
      const wordDiffs = diffWords(oldLine, newLine);

      diffResult[i].wordDiffs = wordDiffs;
      diffResult[i + 1].wordDiffs = wordDiffs;
    }
  }
  return diffResult;
}
