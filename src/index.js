/**
 * Trainer-Assistent by linzenich – Zugangsschutz vor der statischen App.
 *
 * Ablauf jeder Anfrage:
 *
 *   Browser ──▶ Worker (diese Datei)
 *                 │
 *                 ├── /login          → Anmeldeformular, Passwortprüfung
 *                 ├── /logout         → Cookie löschen
 *                 ├── /api/share      → befristeten QR-Link erzeugen (angemeldet)
 *                 ├── /s/<token>      → eine PDF ohne Anmeldung ausliefern
 *                 └── alles andere    → nur mit gültigem Cookie an public/
 *
 * Weil in wrangler.jsonc "run_worker_first": true gesetzt ist, kommt KEINE
 * Datei aus public/ am Worker vorbei.
 */
import { renderLoginPage } from './login-page.js';
import {
  COOKIE_NAME,
  createSessionToken,
  createShareToken,
  verifySessionToken,
  verifyShareToken,
} from './tokens.js';
import { passwordMatches } from './crypto.js';

/** Dateien, die auch ohne Anmeldung nötig sind – sie tragen keine Inhalte. */
const PUBLIC_FILES = new Set([
  '/trainer-assistent-logo.png',
  '/by-linzenich-weiss.png',
  '/favicon.svg',
]);
const PUBLIC_PREFIXES = ['/fonts/'];

/** Nur PDFs aus diesem Ordner dürfen per QR-Code freigegeben werden. */
const SHARE_ROOT = '/dokumente/';

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Die Module bringen ihre Skripte und Styles inline mit.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "object-src 'self' blob:",
    "frame-src 'self' blob:",
    "media-src 'self' blob:",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // "same-origin": nach außen wird nie eine Adresse verraten. Nicht
  // "no-referrer" – das würde den Origin-Header bei Formularen auf "null"
  // setzen und damit die CSRF-Prüfung unten aushebeln.
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
  // Die App ist intern – Suchmaschinen sollen sie nicht indexieren.
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const config = readConfig(env);

    if (config.error) return withSecurityHeaders(configErrorResponse(config.error));

    if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
      return withSecurityHeaders(new Response('Methode nicht erlaubt', { status: 405 }));
    }
    if (request.method === 'POST' && !hasTrustedOrigin(request, url)) {
      return withSecurityHeaders(new Response('Ungültige Herkunft', { status: 403 }));
    }

    const response = await route(request, env, url, config);
    return withSecurityHeaders(response);
  },
};

/* ─────────────────────────────── Routing ─────────────────────────────── */

async function route(request, env, url, config) {
  const path = url.pathname;

  // Öffentlicher QR-Link – bewusst ohne Anmeldung.
  if (path.startsWith('/s/')) return handleShareLink(request, env, url, config);

  if (path === '/login') return handleLogin(request, env, url, config);
  if (path === '/logout') return handleLogout(request);
  if (path === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const signedIn = await isSignedIn(request, config);

  if (path === '/api/share') {
    if (!signedIn) return jsonResponse({ error: 'Nicht angemeldet' }, 401);
    return handleCreateShare(request, env, url, config);
  }

  if (!signedIn && !isPubliclyReadable(path)) return requireLogin(request, url);

  return serveAsset(request, env);
}

/* ───────────────────────────── Anmeldung ─────────────────────────────── */

async function handleLogin(request, env, url, config) {
  const next = safeNext(url.searchParams.get('next'));

  if (request.method !== 'POST') {
    // Wer schon angemeldet ist, braucht das Formular nicht.
    if (await isSignedIn(request, config)) return redirect(next);
    return htmlResponse(renderLoginPage({ next }));
  }

  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const target = safeNext(String(form.get('next') ?? '/'));

  if (!(await withinLoginRateLimit(request, env))) {
    return htmlResponse(
      renderLoginPage({
        next: target,
        error: 'Zu viele Versuche. Bitte warte eine Minute und probiere es erneut.',
      }),
      429,
    );
  }

  if (!(await passwordMatches(config.sessionSecret, password, config.appPassword))) {
    return htmlResponse(
      renderLoginPage({ next: target, error: 'Das Passwort stimmt nicht.' }),
      401,
    );
  }

  const token = await createSessionToken(config.sessionSecret, config.appPassword, config.sessionTtlHours);
  const response = redirect(target);
  response.headers.set('Set-Cookie', sessionCookie(token, config.sessionTtlHours * 3600));
  return response;
}

function handleLogout(request) {
  if (request.method !== 'POST') return redirect('/');
  const response = redirect('/login');
  response.headers.set('Set-Cookie', sessionCookie('', 0));
  return response;
}

async function isSignedIn(request, config) {
  const token = readCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (!token) return false;
  return verifySessionToken(config.sessionSecret, config.appPassword, token);
}

function requireLogin(request, url) {
  const wantsHtml = (request.headers.get('Accept') || '').includes('text/html');
  if (!wantsHtml) return new Response('Nicht angemeldet', { status: 401 });
  return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}

async function withinLoginRateLimit(request, env) {
  if (!env.LOGIN_LIMITER) return true; // z. B. im lokalen Test ohne Binding
  const key = request.headers.get('CF-Connecting-IP') || 'unbekannt';
  try {
    const { success } = await env.LOGIN_LIMITER.limit({ key });
    return success;
  } catch {
    return true; // Rate Limiter darf die Anmeldung nie komplett blockieren
  }
}

/* ───────────────────────── QR-Freigabe für PDFs ──────────────────────── */

async function handleCreateShare(request, env, url, config) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Nur POST' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Ungültige Anfrage' }, 400);
  }

  const file = normalizeSharePath(body?.file);
  if (!file) return jsonResponse({ error: 'Es können nur PDFs aus dem Ordner "dokumente" geteilt werden.' }, 400);

  // Nur freigeben, was es auch wirklich gibt.
  const probe = await env.ASSETS.fetch(new Request(new URL(file, url.origin), { method: 'GET' }));
  if (!probe.ok) return jsonResponse({ error: 'Diese Datei gibt es nicht.' }, 404);

  const requested = Number(body?.ttlHours ?? config.shareDefaultTtlHours);
  const ttlHours = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), config.shareMaxTtlHours)
    : config.shareDefaultTtlHours;

  const { token, expiresAt } = await createShareToken(config.sessionSecret, file, ttlHours);

  return jsonResponse({
    url: `${url.origin}/s/${token}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    ttlHours,
  });
}

async function handleShareLink(request, env, url, config) {
  const token = url.pathname.slice('/s/'.length);
  const file = await verifyShareToken(config.sessionSecret, token);

  if (!file || !normalizeSharePath(file)) return htmlResponse(renderShareExpiredPage(), 410);

  const upstream = await env.ASSETS.fetch(
    new Request(new URL(file, url.origin), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: forwardedHeaders(request),
    }),
  );
  if (!upstream.ok && upstream.status !== 304) return htmlResponse(renderShareExpiredPage(), 410);

  const response = new Response(upstream.body, upstream);
  const name = file.slice(file.lastIndexOf('/') + 1);
  response.headers.set('Content-Type', 'application/pdf');
  response.headers.set('Content-Disposition', `inline; filename="${name}"`);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/**
 * Lässt ausschließlich Pfade der Form /dokumente/<datei>.pdf durch.
 * Unterordner, "..", Prozent-Kodierung und andere Endungen werden abgelehnt.
 */
function normalizeSharePath(value) {
  if (typeof value !== 'string' || value.length > 300) return null;

  const path = value.startsWith('/') ? value : `/${value}`;
  if (!path.startsWith(SHARE_ROOT)) return null;
  if (path.includes('..') || path.includes('%') || path.includes('\\')) return null;

  const name = path.slice(SHARE_ROOT.length);
  if (!name || name.includes('/')) return null;
  if (!/^[\w .()+-]+\.pdf$/i.test(name)) return null;

  return path;
}

function renderShareExpiredPage() {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex, nofollow"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>Link abgelaufen</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;
  font-family:ui-sans-serif,system-ui,sans-serif;color:#f2efe8;
  background:radial-gradient(ellipse 120% 90% at 50% 40%,#14463a 0%,#0c3025 38%,#081e18 70%,#050f0c 100%)}
.box{max-width:26rem;text-align:center;background:linear-gradient(158deg,#1c5645,#0f382d);
  padding:2.5rem 2rem;border-radius:1.25rem;border:1px solid rgba(216,184,137,.3);
  box-shadow:0 22px 40px -18px rgba(0,0,0,.7)}
h1{font-size:1.3rem;margin:0 0 .75rem}
p{margin:0;font-size:.95rem;line-height:1.65;color:#9fb3aa}
</style></head>
<body><div class="box">
<h1>Dieser Link ist abgelaufen</h1>
<p>QR-Codes für Dokumente gelten nur für einen begrenzten Zeitraum.
Bitte wende Dich an Deinen Trainer – er erstellt Dir in wenigen Sekunden einen neuen Code.</p>
</div></body></html>`;
}

/* ─────────────────────────── Statische Dateien ───────────────────────── */

async function serveAsset(request, env) {
  const upstream = await env.ASSETS.fetch(request);
  const response = new Response(upstream.body, upstream);
  const type = response.headers.get('Content-Type') || '';
  const path = new URL(request.url).pathname;

  // Angemeldete Inhalte dürfen niemals in einem gemeinsamen Cache landen.
  const longLived = PUBLIC_PREFIXES.some((p) => path.startsWith(p)) || path.startsWith('/vendor/');
  response.headers.set(
    'Cache-Control',
    longLived ? 'private, max-age=604800' : type.includes('text/html') ? 'private, no-store' : 'private, max-age=3600',
  );
  return response;
}

function isPubliclyReadable(path) {
  return PUBLIC_FILES.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/* ──────────────────────────────── Helfer ─────────────────────────────── */

function readConfig(env) {
  const appPassword = env.APP_PASSWORD;
  const sessionSecret = env.SESSION_SECRET;

  if (!appPassword) return { error: 'APP_PASSWORD' };
  if (!sessionSecret) return { error: 'SESSION_SECRET' };

  const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    appPassword,
    sessionSecret,
    sessionTtlHours: number(env.SESSION_TTL_HOURS, 720),
    shareDefaultTtlHours: number(env.SHARE_DEFAULT_TTL_HOURS, 72),
    shareMaxTtlHours: number(env.SHARE_MAX_TTL_HOURS, 720),
  };
}

function configErrorResponse(missing) {
  return htmlResponse(
    `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex, nofollow"/>
<title>Einrichtung unvollständig</title></head><body
style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1.5rem;line-height:1.7;color:#1a1a1a">
<h1 style="font-size:1.35rem">Einrichtung noch nicht abgeschlossen</h1>
<p>Der laufende Worker sieht das Geheimnis <code>${missing}</code> nicht. Ohne
dieses Geheimnis startet die App aus Sicherheitsgründen nicht.</p>

<h2 style="font-size:1.05rem;margin-top:2rem">Wenn Du über das Cloudflare-Dashboard arbeitest</h2>
<p>Steht das Geheimnis dort scheinbar schon drin? Dann liegt es fast immer an
einem dieser drei Punkte – bitte der Reihe nach prüfen:</p>
<ol>
<li><strong>Wurde wirklich gespeichert?</strong> Öffne
<em>Settings → Variables and secrets</em> und lade die Seite mit F5 neu.
Verschwindet der Eintrag, war er nur getippt und nicht mit <em>Deploy</em>
übernommen.</li>
<li><strong>Steht es am richtigen Ort?</strong> <em>Settings → Variables and
secrets</em> ist richtig. <em>Settings → Build → Build variables and secrets</em>
ist falsch – diese Werte gelten nur beim Bauen und sind hier unsichtbar.</li>
<li><strong>Gibt es den Worker doppelt?</strong> Prüfe unter
<em>Compute (Workers)</em>, ob zwei ähnlich benannte Worker existieren. Dann
liegt das Geheimnis beim einen und der Code beim anderen. Der Name in
<code>wrangler.jsonc</code> muss exakt dem Worker entsprechen, den Du hier
aufrufst.</li>
</ol>

<h2 style="font-size:1.05rem;margin-top:2rem">Wenn Du vom eigenen Rechner deployst</h2>
<pre style="background:#f4f4f4;padding:1rem;border-radius:.5rem;overflow-x:auto"><code>npx wrangler secret put ${missing}</code></pre>

<p style="margin-top:2rem;color:#555">Ausführlich in der <code>ANLEITUNG.md</code>,
Abschnitt 3A (Dashboard) bzw. 3B (eigener Rechner).</p>
</body></html>`,
    503,
  );
}

/** Verhindert Weiterleitungen auf fremde Seiten (Open Redirect). */
function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.includes('\\')) return '/';
  if (value.startsWith('/login') || value.startsWith('/logout')) return '/';
  return value;
}

/**
 * Schutz vor CSRF: Ein Formular auf einer fremden Seite darf keine Aktion
 * in unserem Namen auslösen. Browser schicken bei POST immer einen
 * Origin-Header – bei fremder Herkunft entweder die fremde Adresse oder
 * "null". Beides wird abgelehnt. Fehlt der Header ganz, kommt die Anfrage
 * nicht aus einem Browser (z. B. curl) und ist damit kein CSRF-Fall.
 */
function hasTrustedOrigin(request, url) {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}

function sessionCookie(value, maxAgeSeconds) {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function forwardedHeaders(request) {
  const headers = new Headers();
  for (const name of ['Range', 'If-None-Match', 'If-Modified-Since', 'Accept-Encoding']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

function withSecurityHeaders(response) {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) result.headers.set(name, value);
  return result;
}
