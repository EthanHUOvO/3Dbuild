import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDirectory = resolve(process.cwd(), "dist");
const configuredBase = process.env.PAGES_BASE_PATH ?? "/3Dbuild/";
const base = `/${configuredBase.replace(/^\/+|\/+$/g, "")}/`;
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectHtmlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }

  return files;
}

const htmlFiles = await collectHtmlFiles(distDirectory);
for (const file of htmlFiles) {
  let html = await readFile(file, "utf8");

  // Vite rewrites compiled JS/CSS asset URLs using `base`, but ordinary
  // navigation and public-file links remain root-relative. Prefix those links
  // so they work under https://<user>.github.io/3Dbuild/.
  html = html
    .replace(/href="\/(?!\/)/g, `href="${base}`)
    .replace(/content="\/(?!\/)/g, `content="${base}`)
    .replace(new RegExp(`${escapedBase}${escapedBase.slice(1)}`, "g"), base);

  await writeFile(file, html, "utf8");
}

await writeFile(resolve(distDirectory, ".nojekyll"), "", "utf8");
console.log(`Prepared ${htmlFiles.length} HTML files for GitHub Pages at ${base}`);
