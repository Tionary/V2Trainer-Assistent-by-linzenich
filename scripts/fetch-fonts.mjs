#!/usr/bin/env node
/**
 * Lädt die von der App genutzten Google-Fonts herunter und legt sie unter
 * public/fonts/ ab, damit die App KEINE Verbindung zu Google-Servern aufbaut
 * (DSGVO: keine IP-Übertragung an Google beim Seitenaufruf).
 *
 * Aufruf:  npm run fetch:fonts
 *
 * Das Ergebnis ist eingecheckt – dieses Skript muss nur laufen, wenn eine
 * Schriftart ausgetauscht oder aktualisiert werden soll.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_NAMES } from './icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/fonts');

// Chrome-UA, damit Google woff2 statt ttf ausliefert.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SOURCES = [
  'https://fonts.googleapis.com/css2?family=Italianno&family=Source+Sans+3:wght@200;300;400;500;600;700;800;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200' +
    `&icon_names=${[...ICON_NAMES].sort().join(',')}`,
];

// Für deutsche Texte reichen diese Subsets – spart ~75 % Datenvolumen.
// 'fallback' ist der Block, unter dem Google die Material-Symbols-Variable-Font
// ausliefert (sie hat keine Subsets).
const KEEP_SUBSETS = new Set(['latin', 'latin-ext', 'fallback']);

/** Zerlegt das Google-CSS in Blöcke aus `/* subset *\/` + `@font-face{...}`. */
function parseBlocks(css) {
  const blocks = [];
  const re = /\/\*\s*([^*]+?)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    blocks.push({ subset: m[1], rule: m[2] });
  }
  // Material Symbols kommt ohne Subset-Kommentar.
  if (blocks.length === 0) {
    for (const rule of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
      blocks.push({ subset: 'latin', rule });
    }
  }
  return blocks;
}

function fileNameFor(rule, subset, used) {
  const family = (rule.match(/font-family:\s*'([^']+)'/) || [, 'font'])[1]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const weight = (rule.match(/font-weight:\s*([^;]+)/) || [, 'x'])[1]
    .trim()
    .replace(/\s+/g, '-');
  const style = (rule.match(/font-style:\s*([^;]+)/) || [, 'normal'])[1].trim();
  let base = `${family}-${weight}${style === 'italic' ? '-italic' : ''}-${subset}`;
  let name = `${base}.woff2`;
  let i = 2;
  while (used.has(name)) name = `${base}-${i++}.woff2`;
  used.add(name);
  return name;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const used = new Set();
  const out = [
    '/* Selbst gehostete Schriften – erzeugt von scripts/fetch-fonts.mjs.',
    '   Bitte nicht von Hand bearbeiten. */',
    '',
  ];
  let downloaded = 0;

  for (const src of SOURCES) {
    const res = await fetch(src, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`CSS ${src} → HTTP ${res.status}`);
    const css = await res.text();

    for (const { subset, rule } of parseBlocks(css)) {
      if (!KEEP_SUBSETS.has(subset)) continue;
      const url = (rule.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/) || [])[1];
      if (!url) continue;

      const fontRes = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!fontRes.ok) throw new Error(`Font ${url} → HTTP ${fontRes.status}`);
      const name = fileNameFor(rule, subset, used);
      await writeFile(resolve(OUT_DIR, name), Buffer.from(await fontRes.arrayBuffer()));
      downloaded++;

      out.push(rule.replace(/url\(https:\/\/fonts\.gstatic\.com[^)]+\)/, `url('./${name}')`), '');
    }

    // Nicht-@font-face-Regeln (z. B. die .material-symbols-outlined-Hilfsklasse)
    // mit übernehmen, sonst fehlen Ligaturen und Icon-Grundstil.
    for (const rule of css.replace(/@font-face\s*\{[^}]*\}/g, '').match(/[.#][^{}]+\{[^}]*\}/g) || []) {
      out.push(rule.trim(), '');
    }
  }

  await writeFile(resolve(OUT_DIR, 'fonts.css'), out.join('\n'));
  console.log(`${downloaded} Schriftdateien nach public/fonts/ geladen.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
