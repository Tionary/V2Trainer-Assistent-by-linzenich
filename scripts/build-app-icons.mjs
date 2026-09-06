#!/usr/bin/env node
/**
 * Erzeugt die App-Icons unter public/icons/ – also die Bilder, die auf dem
 * Startbildschirm erscheinen, wenn jemand die App dort ablegt.
 *
 * Warum ein eigenes Skript und kein Bildbearbeitungsprogramm?
 * Android, iOS und Windows verlangen jeweils andere Kantenlängen und
 * unterschiedliche Ränder (siehe VARIANTEN unten). Von Hand zugeschnitten
 * verrutscht dabei zuverlässig etwas. Hier steht die Zeichnung einmal als
 * Vektor (ICON = dieselben Linien wie public/favicon.svg) und wird für jede
 * geforderte Größe frisch gerastert – ohne Fremdbibliothek, nur mit dem
 * zlib-Modul von Node.
 *
 * Aufruf:  npm run build:icons
 *
 * Das Ergebnis ist eingecheckt. Das Skript muss nur laufen, wenn sich das
 * Icon ändern soll oder eine Größe dazukommt.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/icons');

/* ─────────────────────────── Die Zeichnung ──────────────────────────── */

/**
 * Alle Koordinaten in einem 64×64-Raster – identisch zu public/favicon.svg.
 * Die Linien sind Zugfolgen ("polyline"): aufeinanderfolgende Punkte werden
 * mit runden Enden und runden Ecken verbunden.
 */
const ICON = {
  size: 64,
  cornerRadius: 14,
  strokeWidth: 4.5,
  background: { from: '#1c5645', to: '#0a261f' }, // oben → unten
  stroke: { from: '#7d6240', mid: '#af8f61', to: '#d8b889' }, // unten links → oben rechts
  lines: [
    // Leistungskurve
    [[6, 38], [14, 38], [19, 24], [26, 48], [32, 18], [37, 38], [41, 38]],
    // Pfeil nach oben rechts: Schaft …
    [[41, 38], [55, 22]],
    // … und Spitze
    [[45, 21], [56, 21], [56, 32]],
  ],
};

/**
 * Welche Datei wofür:
 *
 *   rounded  – Android/Chrome und der Browser-Tab. Eigene abgerundete Ecken,
 *              weil das System das Bild unverändert übernimmt.
 *   apple    – iPhone/iPad. Randlos und deckend; iOS schneidet die Ecken
 *              selbst ab, deshalb etwas Luft um die Zeichnung.
 *   maskable – Android darf frei zuschneiden (Kreis, Tropfen, Quadrat).
 *              Die Zeichnung muss deshalb in den inneren 80 % liegen.
 */
const VARIANTS = {
  rounded: { round: true, artScale: 1 },
  apple: { round: false, artScale: 0.86 },
  maskable: { round: false, artScale: 0.76 },
};

const TARGETS = [
  // Browser-Tab und Verknüpfungen
  ['icon-16.png', 16, 'rounded'],
  ['icon-32.png', 32, 'rounded'],
  ['icon-48.png', 48, 'rounded'],
  ['icon-64.png', 64, 'rounded'],
  ['icon-96.png', 96, 'rounded'],
  ['icon-128.png', 128, 'rounded'],
  ['icon-192.png', 192, 'rounded'],
  ['icon-256.png', 256, 'rounded'],
  ['icon-384.png', 384, 'rounded'],
  ['icon-512.png', 512, 'rounded'],
  // iOS – je Gerätegröße die passende Kantenlänge
  ['apple-touch-icon-120.png', 120, 'apple'], // iPhone
  ['apple-touch-icon-152.png', 152, 'apple'], // iPad
  ['apple-touch-icon-167.png', 167, 'apple'], // iPad Pro
  ['apple-touch-icon-180.png', 180, 'apple'], // iPhone Plus/Pro
  // Android, frei zuschneidbar
  ['maskable-192.png', 192, 'maskable'],
  ['maskable-512.png', 512, 'maskable'],
];

/* ──────────────────────────── Farbhelfer ────────────────────────────── */

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mischt zwei Farben; t = 0 ergibt a, t = 1 ergibt b. */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Farbverlauf über drei Stützstellen (0 – 0,55 – 1). */
function threeStop(from, mid, to, t) {
  return t <= 0.55 ? mix(from, mid, t / 0.55) : mix(mid, to, (t - 0.55) / 0.45);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ─────────────────── Abstandsfunktionen (Rasterung) ─────────────────── */
/*
 * Gezeichnet wird nicht Pixel für Pixel, sondern über den Abstand zur Form:
 * negativ = innen, 0 = genau auf der Kante, positiv = außen. Aus dem Abstand
 * ergibt sich direkt, wie stark ein Randpixel gefärbt wird – daher die
 * weichen Kanten ohne Mehrfachabtastung.
 */

/** Abstand zu einem Rechteck mit runden Ecken, Mittelpunkt (cx, cy). */
function distRoundRect(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - (halfW - r);
  const qy = Math.abs(y - cy) - (halfH - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}

/** Abstand zu einer Strecke mit runden Enden (Kapsel). */
function distSegment(x, y, ax, ay, bx, by, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp01(((x - ax) * dx + (y - ay) * dy) / len2);
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) - radius;
}

/* ──────────────────────────── PNG schreiben ─────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA-Pixel (Uint8Array, 4 Byte je Pixel) → PNG-Datei. */
function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 Bit je Kanal
  ihdr[9] = 6; // Farbtyp 6 = RGBA
  // Byte 10–12 bleiben 0: Standard-Kompression, Standard-Filter, kein Interlace.

  // Jede Bildzeile bekommt ein Filter-Byte (0 = unverändert) vorangestellt.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const at = y * (size * 4 + 1);
    raw[at] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, at + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ─────────────────────────────── Rastern ────────────────────────────── */

function render(size, variant) {
  const { round, artScale } = VARIANTS[variant];
  const unit = ICON.size; // 64
  const scale = size / unit; // Einheiten → Pixel
  const bgFrom = rgb(ICON.background.from);
  const bgTo = rgb(ICON.background.to);
  const strokeFrom = rgb(ICON.stroke.from);
  const strokeMid = rgb(ICON.stroke.mid);
  const strokeTo = rgb(ICON.stroke.to);
  const center = unit / 2;
  const half = unit / 2;
  const radius = round ? ICON.cornerRadius : 0;
  const strokeRadius = (ICON.strokeWidth / 2) * artScale;

  // Zeichnung um die Bildmitte skalieren, damit für iOS/Android Luft bleibt.
  const lines = ICON.lines.map((points) =>
    points.map(([x, y]) => [center + (x - center) * artScale, center + (y - center) * artScale]),
  );

  const pixels = new Uint8Array(size * size * 4);

  for (let py = 0; py < size; py++) {
    const y = (py + 0.5) / scale;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / scale;

      // Hintergrund
      const bgCover = clamp01(0.5 - distRoundRect(x, y, center, center, half, half, radius) * scale);
      let [r, g, b] = mix(bgFrom, bgTo, clamp01(y / unit));
      let a = bgCover;

      // Linien darüber
      let d = Infinity;
      for (const points of lines) {
        for (let i = 0; i < points.length - 1; i++) {
          const [ax, ay] = points[i];
          const [bx, by] = points[i + 1];
          d = Math.min(d, distSegment(x, y, ax, ay, bx, by, strokeRadius));
        }
      }
      const lineCover = clamp01(0.5 - d * scale) * bgCover; // nie über den Rand hinaus
      if (lineCover > 0) {
        // Verlauf diagonal: unten links dunkel, oben rechts hell.
        const t = clamp01((x / unit + (1 - y / unit)) / 2);
        const [lr, lg, lb] = threeStop(strokeFrom, strokeMid, strokeTo, t);
        r = r + (lr - r) * lineCover;
        g = g + (lg - g) * lineCover;
        b = b + (lb - b) * lineCover;
        a = Math.max(a, lineCover);
      }

      const at = (py * size + px) * 4;
      pixels[at] = Math.round(r);
      pixels[at + 1] = Math.round(g);
      pixels[at + 2] = Math.round(b);
      pixels[at + 3] = Math.round(a * 255);
    }
  }

  return encodePng(pixels, size);
}

/* ──────────────────────── Vektorfassung (SVG) ───────────────────────── */

/**
 * Dieselbe Zeichnung als SVG – Android und Chrome bevorzugen sie, weil sie
 * in jeder Auflösung scharf ist. Die PNGs bleiben als Rückfallebene nötig
 * (iOS und Windows lesen kein SVG-App-Icon).
 */
function renderSvg() {
  const path = (points) =>
    points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const lines = ICON.lines
    .map(
      (points) =>
        `  <path d="${path(points)}" fill="none" stroke="url(#gold)" stroke-width="${ICON.strokeWidth}"\n` +
        '        stroke-linecap="round" stroke-linejoin="round"/>',
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON.size} ${ICON.size}"
     role="img" aria-label="Trainer-Assistent by linzenich">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ICON.background.from}"/>
      <stop offset="1" stop-color="${ICON.background.to}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${ICON.stroke.from}"/>
      <stop offset="55%" stop-color="${ICON.stroke.mid}"/>
      <stop offset="1" stop-color="${ICON.stroke.to}"/>
    </linearGradient>
  </defs>
  <rect width="${ICON.size}" height="${ICON.size}" rx="${ICON.cornerRadius}" fill="url(#bg)"/>
${lines}
</svg>
`;
}

/* ──────────────────────────────── Ablauf ────────────────────────────── */

await mkdir(OUT_DIR, { recursive: true });

let bytes = 0;
for (const [name, size, variant] of TARGETS) {
  const png = render(size, variant);
  await writeFile(resolve(OUT_DIR, name), png);
  bytes += png.length;
}
await writeFile(resolve(OUT_DIR, 'app-icon.svg'), renderSvg());

console.log(
  `App-Icons geschrieben: ${TARGETS.length} PNG (${Math.round(bytes / 1024)} KB) ` +
    'und app-icon.svg in public/icons/.',
);
