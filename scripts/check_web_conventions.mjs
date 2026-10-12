// Static guard for the frontend conventions in AGENTS.md ("前端约定"). Each rule records a
// mistake that was already made once; add a rule here when a new kind slips back in.
// Run with `pnpm test:web`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const appDir = join(root, "app");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(appDir);
const css = files.filter((path) => path.endsWith(".css"));
const code = files.filter((path) => /\.(tsx?|mjs)$/.test(path));
const problems = [];
const report = (path, index, source, message) => {
  const line = source.slice(0, index).split("\n").length;
  problems.push(`${relative(root, path)}:${line}  ${message}`);
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

// 3. Native dialogs and selects: the desktop webview cannot always show them, and they ignore the theme.
for (const path of code) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?<![\w.])(?:window\.)?(confirm|alert|prompt)\(/g)) {
    report(path, match.index, source, `${match[1]}() — use confirmDialog / noticeDialog from components/ConfirmDialog`);
  }
  if (!path.endsWith("components/Select.tsx")) {
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

if (problems.length) {
  console.error(`Frontend convention problems (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Frontend conventions OK (${css.length} stylesheets, ${code.length} scripts).`);
