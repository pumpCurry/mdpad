/**
 * generate-emoji-data.js
 *
 * Reads GitHub gemoji database and generates:
 *   src/renderer/data/emoji-names.js
 *
 * Usage: node scripts/generate-emoji-data.js
 */

const fs = require("fs");
const path = require("path");

// Read gemoji data
const gemojiPath = process.argv[2] || "/tmp/gemoji.json";
const gemoji = JSON.parse(fs.readFileSync(gemojiPath, "utf8"));

// ── Category mapping ──
// gemoji categories -> our picker categories
const CATEGORY_MAP = {
  "Smileys & Emotion": "smileys",
  "People & Body": "people",
  "Animals & Nature": "nature",
  "Food & Drink": "food",
  "Travel & Places": "travel",
  "Activities": "activities",
  "Objects": "objects",
  "Symbols": "symbols",
  "Flags": "flags",
};

// Category display order and icons
const CATEGORY_META = {
  smileys: { icon: "\\u{1F600}", label: "Smileys" },
  people: { icon: "\\u{1F464}", label: "People" },
  nature: { icon: "\\u{1F43B}", label: "Animals" },
  food: { icon: "\\u{1F354}", label: "Food" },
  travel: { icon: "\\u{2708}\\u{FE0F}", label: "Travel" },
  activities: { icon: "\\u{26BD}", label: "Activities" },
  objects: { icon: "\\u{1F4BB}", label: "Objects" },
  symbols: { icon: "\\u{2764}\\u{FE0F}", label: "Symbols" },
  flags: { icon: "\\u{1F3F4}", label: "Flags" },
};

const CATEGORY_ORDER = ["smileys", "people", "nature", "food", "travel", "activities", "objects", "symbols", "flags"];

// Convert emoji character(s) to \u{XXXXX} escape format
function toEscape(str) {
  let result = "";
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp > 0x7f) {
      result += "\\u{" + cp.toString(16).toUpperCase() + "}";
    } else {
      result += ch;
    }
  }
  return result;
}

// Organize emojis by category
const categories = {};
const nameEntries = [];
const skinToneSet = [];
const aliasEntries = []; // All shortcode aliases -> emoji (for :shortcode: rendering)

for (const catId of CATEGORY_ORDER) {
  categories[catId] = [];
}

for (const entry of gemoji) {
  if (!entry.emoji || !entry.category) continue;

  const catId = CATEGORY_MAP[entry.category];
  if (!catId) continue;

  // Skip entries with ZWJ sequences that are too complex (multi-person compositions)
  // Keep single-person variants and basic ZWJ
  const alias = entry.aliases[0] || entry.description.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  categories[catId].push({
    emoji: entry.emoji,
    escaped: toEscape(entry.emoji),
    alias: alias,
    name: entry.description,
    skinTones: entry.skin_tones === true,
  });

  // Name entry (primary alias only)
  nameEntries.push({
    escaped: toEscape(entry.emoji),
    alias: alias,
    name: entry.description,
  });

  // All aliases -> emoji (for markdown :shortcode: rendering)
  for (const a of entry.aliases || []) {
    aliasEntries.push({ alias: a, escaped: toEscape(entry.emoji) });
  }

  // Skin tone
  if (entry.skin_tones === true) {
    skinToneSet.push(toEscape(entry.emoji));
  }
}

// ── Generate emoji-names.js ──

let output = `/**
 * emoji-names.js
 *
 * Emoji name/shortcode database and skin tone support metadata.
 * AUTO-GENERATED from GitHub gemoji database.
 * Do not edit manually. Run: node scripts/generate-emoji-data.js
 */

// Map: emoji character -> { shortcode, name }
export const EMOJI_NAMES = new Map([
`;

for (const entry of nameEntries) {
  output += `  ["${entry.escaped}", { shortcode: "${entry.alias}", name: ${JSON.stringify(entry.name)} }],\n`;
}

output += `]);

// Set of base emoji characters that support skin tone modifiers (U+1F3FB - U+1F3FF).
export const SKIN_TONE_EMOJI = new Set([
`;

for (const escaped of skinToneSet) {
  output += `  "${escaped}",\n`;
}

output += `]);

// Category definitions for the emoji picker.
// Each category has: id, icon, label, emojis[]
export const EMOJI_CATEGORIES = [
  {
    id: "recent",
    icon: "\\u{1F552}",
    label: "Recent",
    emojis: [],
  },
`;

for (const catId of CATEGORY_ORDER) {
  const meta = CATEGORY_META[catId];
  const emojis = categories[catId];
  if (emojis.length === 0) continue;

  output += `  {\n`;
  output += `    id: "${catId}",\n`;
  output += `    icon: "${meta.icon}",\n`;
  output += `    label: "${meta.label}",\n`;
  output += `    emojis: [\n`;

  // Write emoji in rows of 8
  for (let i = 0; i < emojis.length; i += 8) {
    const row = emojis.slice(i, i + 8).map((e) => `"${e.escaped}"`);
    output += `      ${row.join(",")},\n`;
  }

  output += `    ],\n`;
  output += `  },\n`;
}

output += `];\n`;

// ── Shortcode-to-emoji reverse map (includes ALL aliases) ──
output += `\n// Reverse map: shortcode -> emoji character (includes all gemoji aliases)\n`;
output += `export const SHORTCODE_TO_EMOJI = new Map([\n`;

for (const entry of aliasEntries) {
  output += `  ["${entry.alias}", "${entry.escaped}"],\n`;
}

output += `]);\n`;

// Write output
const outPath = path.join(__dirname, "..", "src", "renderer", "data", "emoji-names.js");
fs.writeFileSync(outPath, output, "utf8");

// Stats
let totalEmoji = 0;
for (const catId of CATEGORY_ORDER) {
  const count = categories[catId].length;
  totalEmoji += count;
  console.log(`  ${catId}: ${count} emoji`);
}
console.log(`  ---`);
console.log(`  Total: ${totalEmoji} emoji`);
console.log(`  Skin tone capable: ${skinToneSet.length}`);
console.log(`  Written to: ${outPath}`);
