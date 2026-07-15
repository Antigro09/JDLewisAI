import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import matter from "gray-matter";

/**
 * Renders content/legal/eula.md into the plain-text license file the NSIS
 * installer shows (electron/build/license.txt, wired via electron/package.json
 * build.nsis.license). The output is committed so `electron-builder` works
 * standalone; re-run after editing the EULA (`npm run legal:eula`).
 * lib/legal/content.test.ts fails if the generated file goes stale.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "content", "legal", "eula.md");
const target = path.join(root, "electron", "build", "license.txt");

const { data, content } = matter(readFileSync(source, "utf8"));

const text = content
  .replace(/^>\s?(.*)$/gm, "$1") // blockquote banner -> plain line
  .replace(/^##\s+(.*)$/gm, (_, h) => h.toUpperCase()) // headings -> caps
  .replace(/^#\s+(.*)$/gm, (_, h) => h.toUpperCase())
  .replace(/\*\*(.+?)\*\*/g, "$1") // strip bold
  .replace(/\*(.+?)\*/g, "$1") // strip italics
  .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)") // links -> text (url)
  .replace(/\r?\n{3,}/g, "\n\n")
  .trim();

const header = [
  `${String(data.title || "END USER LICENSE AGREEMENT").toUpperCase()}`,
  `ContractorAI Desktop — Version ${data.version || "?"} (updated ${data.lastUpdated || "?"})`,
  "",
  "",
].join("\n");

writeFileSync(target, `${header}${text}\n`);
console.log(`build-eula: wrote ${target} (version ${data.version})`);
