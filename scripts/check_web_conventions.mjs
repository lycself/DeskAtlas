// Static guard for the frontend conventions in AGENTS.md ("前端约定"). Each rule records a
// mistake that was already made once; add a rule here when a new kind slips back in.
// Run with `pnpm test:web`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/D:/…".
const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = join(root, "app");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// Repo-relative path with forward slashes, so checks and messages read the same on every OS.
const posix = (path) => relative(root, path).split(sep).join("/");
const files = walk(appDir);
const css = files.filter((path) => path.endsWith(".css"));
const code = files.filter((path) => /\.(tsx?|mjs)$/.test(path));
const problems = [];
const report = (path, index, source, message) => {
  const line = source.slice(0, index).split("\n").length;
  problems.push(`${posix(path)}:${line}  ${message}`);
};
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));

// 1. Type sizes and corner radii come from the tokens in globals.css.
const allowedRadius = /^(var\(--radius-(micro|control|card|overlay)\)|0|50%|999px|inherit)$/;
// The floating headers morph their radius while scrolling, starting from a token.
const morphingRadius = /^calc\(var\(--radius-(micro|control|card|overlay)\) [^;]*var\(--nav-progress\)\)$/;
const allowedSize = /^(var\(--text-[a-z0-9]+\)|inherit|[\d.]+em|[\d.]+%)( !important)?$/;
for (const path of css) {
  const source = stripComments(readFileSync(path, "utf8"));
  for (const match of source.matchAll(/(?<![-\w])(border(?:-(?:top|bottom)-(?:left|right))?-radius|font-size)\s*:\s*([^;}]+)/g)) {
    const [, property, raw] = match;
    const value = raw.trim();
    const ok = property === "font-size" ? allowedSize.test(value) : morphingRadius.test(value) || value.split(/\s+/).every((part) => allowedRadius.test(part));
    if (!ok) {
      report(path, match.index, source, `${property}: ${value} — use a --${property === "font-size" ? "text" : "radius"}-* token`);
    }
  }
}

// 1b. No outlined boxes (direction B): dashed outlines are reserved for staging areas such as
//     unplaced seats and empty virtual slots, and the "not filled in" tag. Anything else sinks or lifts by tone instead.
const dashedAllowed = new Set([".unplaced-seats", ".virtual-position.placeholder", ".major-tag.unspecified"]);
for (const path of css) {
  const source = stripComments(readFileSync(path, "utf8"));
  for (const match of source.matchAll(/([^{}\n]+)\{[^}]*\b(border(?:-[a-z]+)?(?:-style)?\s*:[^;]*dashed)/g)) {
    const selector = match[1].trim();
    if (!dashedAllowed.has(selector)) report(path, match.index, source, `${selector}: dashed outline — use --inset / --rim instead`);
  }
}

// 2. Every var(--x) must be defined somewhere: a dead token silently falls back to nothing.
const defined = new Set();
for (const path of css) for (const match of readFileSync(path, "utf8").matchAll(/(--[\w-]+)\s*:/g)) defined.add(match[1]);
for (const path of code) for (const match of readFileSync(path, "utf8").matchAll(/["'`](--[\w-]+)["'`]/g)) defined.add(match[1]);
for (const path of [...css, ...code]) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/var\((--[\w-]+)(\s*,)?/g)) {
    if (!defined.has(match[1]) && !match[2]) report(path, match.index, source, `var(${match[1]}) is never defined`);
  }
}

// 2b. Decoration that restates the page (AGENTS.md "密度与流程"): subtitles under a page title,
//     eyebrow labels above it and hero descriptions were removed on 2026-11-25.
for (const path of code) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/\b(page-subtitle|page-eyebrow|hero-description)\b/g)) {
    report(path, match.index, source, `${match[1]} — page headings carry only the title and the page's actions`);
  }
}

// 3. Native dialogs and selects: the desktop webview cannot always show them, and they ignore the theme.
for (const path of code) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?<![\w.])(?:window\.)?(confirm|alert|prompt)\(/g)) {
    report(path, match.index, source, `${match[1]}() — use confirmDialog / noticeDialog from components/ConfirmDialog`);
  }
  if (posix(path) !== "app/components/Select.tsx") {
    for (const match of source.matchAll(/<select[\s>]/g)) report(path, match.index, source, "<select> — use components/Select");
  }
}

// 4. next/dynamic needs an inline loading option: without it there is no Suspense boundary and the
//    first load suspends the whole page around the component.
for (const path of code) {
  const source = readFileSync(path, "utf8");
  if (!/from "next\/dynamic"/.test(source)) continue;
  for (const match of source.matchAll(/\bdynamic\(/g)) {
    let depth = 0, options = -1, index = match.index + match[0].length - 1;
    for (; index < source.length; index++) {
      const char = source[index];
      if ("([{".includes(char)) depth++;
      else if (")]}".includes(char)) { depth--; if (depth === 0) break; }
      else if (char === "," && depth === 1) options = index + 1;
    }
    // Next only reads options written as an object literal at the call.
    const literal = options < 0 ? "" : source.slice(options, index).trim();
    if (!/^\{[\s\S]*\bloading\s*:/.test(literal)) report(path, match.index, source, "dynamic() needs an inline { loading } option");
  }
}

// 5. Escape handlers must let an IME composition finish; Escape there only cancels the candidates.
for (const path of code) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/key === "Escape"/g)) {
    const scope = source.slice(Math.max(0, match.index - 1500), match.index + 200);
    if (!/isComposing/.test(scope)) report(path, match.index, source, "Escape handling without an isComposing check");
  }
}

// 6. Short row actions must retain their intrinsic width; Chinese labels may not split vertically.
const globalsPath = join(appDir, "globals.css");
const globalStyles = stripComments(readFileSync(globalsPath, "utf8"));
const rowAction = globalStyles.match(/\.row-action\s*\{([^}]+)\}/);
if (!rowAction || !/white-space\s*:\s*nowrap/.test(rowAction[1]) || !/min-inline-size\s*:\s*max-content/.test(rowAction[1])) {
  report(globalsPath, rowAction?.index ?? 0, globalStyles, "row actions need nowrap and intrinsic minimum width");
}

// 7. Both themes must keep semantic text readable on every main surface.
const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
const luminance = (hex) => rgb(hex).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
for (const [theme, expression] of [["day", /:root\s*\{([^}]*)\}/], ["night", /:root\[data-theme="night"\]\s*\{([^}]*)\}/]]) {
  const block = globalStyles.match(expression);
  const palette = Object.fromEntries([...(block?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*(#[\da-fA-F]{6})/g)].map((match) => [match[1], match[2]]));
  const pairs = ["--ink", "--ink-soft", "--accent-text", "--danger", "--warning", "--success-text"].flatMap((ink) => ["--bg", "--surface", "--surface-muted", "--overlay-bg"].map((paper) => [ink, paper]));
  pairs.push(["--accent-ink", "--accent"]);
  for (const [ink, paper] of pairs) {
    if (!palette[ink] || !palette[paper] || contrast(palette[ink], palette[paper]) < 4.5) report(globalsPath, block?.index ?? 0, globalStyles, `${theme}: ${ink} on ${paper} must reach 4.5:1 contrast`);
  }
  for (const paper of ["--bg", "--surface", "--overlay-bg"]) {
    if (!palette["--scrollbar-thumb"] || contrast(palette["--scrollbar-thumb"], palette[paper]) < 3) report(globalsPath, block?.index ?? 0, globalStyles, `${theme}: scrollbar thumb on ${paper} must reach 3:1 contrast`);
  }
}

// 8. Local scrollbar overrides bypass the shared WebKit/Firefox treatment and reintroduce tracks.
for (const path of css.filter((path) => path !== globalsPath)) {
  const source = stripComments(readFileSync(path, "utf8"));
  for (const match of source.matchAll(/scrollbar-(?:width|color)\s*:|::-webkit-scrollbar/g)) report(path, match.index, source, "scrollbars belong to globals.css, including portal menus");
}

if (problems.length) {
  console.error(`Frontend convention problems (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Frontend conventions OK (${css.length} stylesheets, ${code.length} scripts).`);
