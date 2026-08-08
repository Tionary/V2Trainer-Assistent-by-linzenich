#!/usr/bin/env node
/**
 * Erzeugt public/dokumente/manifest.json – die Liste, aus der die Seite
 * "Dokumente & QR-Codes" ihre Einträge aufbaut.
 *
 * Läuft automatisch bei `npm run dev` und `npm run deploy`.
 * Neue PDF bereitstellen heißt also: Datei nach public/dokumente/ legen,
 * fertig. Mehr ist nicht zu tun.
 *
 * Optional: public/dokumente/titel.json mit schöneren Anzeigenamen, z. B.
 *   { "FriendlyFood-ebook.pdf": "Friendly Food – das Kochbuch" }
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = resolve(ROOT, 'public/dokumente');

/** "FriendlyFood-ebook.pdf" → "FriendlyFood ebook" */
function titleFromFileName(fileName) {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readTitleOverrides() {
  try {
    return JSON.parse(await readFile(resolve(DOCS_DIR, 'titel.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  const overrides = await readTitleOverrides();
  const entries = [];

  for (const fileName of await readdir(DOCS_DIR)) {
    if (!fileName.toLowerCase().endsWith('.pdf')) continue;
    const info = await stat(resolve(DOCS_DIR, fileName));
    entries.push({
      file: fileName,
      title: overrides[fileName] || titleFromFileName(fileName),
      sizeBytes: info.size,
    });
  }

  entries.sort((a, b) => a.title.localeCompare(b.title, 'de'));

  await writeFile(
    resolve(DOCS_DIR, 'manifest.json'),
    `${JSON.stringify({ documents: entries }, null, 2)}\n`,
  );

  console.log(
    `manifest.json geschrieben: ${entries.length} PDF${entries.length === 1 ? '' : 's'} in public/dokumente/.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
