#!/usr/bin/env node
/**
 * Warnt, wenn im HTML ein Icon verwendet wird, das nicht in scripts/icons.mjs
 * steht. Solche Icons erscheinen im Browser als geschriebenes Wort
 * ("visibility") statt als Symbol – ein Fehler, den man beim schnellen
 * Drüberschauen leicht übersieht.
 *
 * Läuft automatisch bei `npm run deploy`. Blockiert die Veröffentlichung
 * NICHT – ein fehlendes Icon ist ein Schönheitsfehler, kein Ausfall.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_NAMES } from './icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const known = new Set(ICON_NAMES);

/**
 * Icons, die nicht über eine "ms"-CSS-Klasse eingebunden sind und deshalb
 * von der Suche unten nicht gefunden werden (z. B. per JavaScript gesetzt).
 */
const USED_ELSEWHERE = ['visibility', 'visibility_off', 'close'];

/** Findet <span class="ms ...">icon_name</span> und die Tailwind-Variante. */
const PATTERN =
  /<(?:span|i|button)[^>]*class="[^"]*(?:\bms\b|material-symbols-outlined)[^"]*"[^>]*>\s*([a-z][a-z0-9_]*)\s*</g;

async function collect() {
  const found = new Map(); // Icon-Name → Dateien

  const files = [
    ...(await readdir(resolve(ROOT, 'public')))
      .filter((f) => f.endsWith('.html'))
      .map((f) => `public/${f}`),
    'src/login-page.js',
  ];

  for (const file of files) {
    const text = await readFile(resolve(ROOT, file), 'utf8');
    for (const [, name] of text.matchAll(PATTERN)) {
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(file);
    }
  }

  for (const name of USED_ELSEWHERE) {
    if (!found.has(name)) found.set(name, new Set(['(per JavaScript)']));
  }

  return found;
}

const found = await collect();
const missing = [...found].filter(([name]) => !known.has(name));

if (missing.length === 0) {
  console.log(`Icons in Ordnung: alle ${found.size} verwendeten Symbole sind in der Schrift enthalten.`);
} else {
  console.warn('\n⚠️  Diese Icons werden verwendet, fehlen aber in der Icon-Schrift:\n');
  for (const [name, files] of missing) {
    console.warn(`    ${name}   (in ${[...files].join(', ')})`);
  }
  console.warn('\n    Sie erscheinen im Browser als Text statt als Symbol. So behebst Du das:');
  console.warn(`    1. Namen in scripts/icons.mjs ergänzen: ${missing.map(([n]) => `'${n}'`).join(', ')}`);
  console.warn('    2. npm run fetch:fonts');
  console.warn('    3. Änderungen committen und erneut veröffentlichen\n');
}
