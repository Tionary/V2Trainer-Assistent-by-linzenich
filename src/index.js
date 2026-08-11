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

    // Diagnoseseite: zeigt, welche Werte im laufenden Worker ankommen.
    // Solange die Einrichtung unvollständig ist, ohne Anmeldung erreichbar –
    // genau dann braucht man sie, und es gibt noch nichts zu schützen.
    if (url.pathname === '/__status') {
      return withSecurityHeaders(await handleStatus(request, env, config));
    }

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

/**
 * Sucht Einträge, die fast so heißen wie der gesuchte – also nur in
 * Groß-/Kleinschreibung, Unterstrichen oder Leerzeichen abweichen.
 *
 * Cloudflare unterscheidet Groß- und Kleinschreibung: Ein im Dashboard als
 * "App_Password" angelegtes Geheimnis erreicht `env.APP_PASSWORD` nicht.
 * Im Dashboard sieht dabei alles völlig richtig aus.
 */
function findSimilarBindingNames(env, wanted) {
  const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(wanted);
  return Object.keys(env).filter((key) => key !== wanted && normalize(key) === target);
}

/**
 * Prüft ein Geheimnis und benennt das Problem genau. Der Unterschied
 * zwischen "gar nicht da" und "da, aber leer" ist bei der Fehlersuche
 * entscheidend: Im Dashboard sehen beide Fälle identisch aus
 * ("Value encrypted"), die Ursachen sind aber völlig verschieden.
 */
function inspectSecret(env, name) {
  const value = env[name];
  if (value === undefined || value === null) {
    return { name, kind: 'fehlt', aehnlich: findSimilarBindingNames(env, name) };
  }
  if (typeof value !== 'string') return { name, kind: 'kein-text', aehnlich: [] };
  if (value.trim() === '') return { name, kind: 'leer', aehnlich: [] };
  return null;
}

function readConfig(env) {
  const appPassword = env.APP_PASSWORD;
  const sessionSecret = env.SESSION_SECRET;

  const problem = inspectSecret(env, 'APP_PASSWORD') || inspectSecret(env, 'SESSION_SECRET');
  if (problem) return { error: problem };

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

function configErrorResponse(problem) {
  const { name, kind, aehnlich = [] } = problem;

  // Häufigster Fall in der Praxis: Der Eintrag existiert, heißt aber
  // minimal anders geschrieben. Das steht ganz oben, weil man es sonst
  // stundenlang übersieht.
  const nearMiss = aehnlich.length
    ? `<p style="background:#fff4e5;border-left:4px solid #f59e0b;padding:.9rem 1rem;border-radius:.3rem">
<strong>Das ist mit hoher Wahrscheinlichkeit die Ursache:</strong> Es gibt einen
Eintrag namens <code>${aehnlich.map((n) => n.replace(/[<>&]/g, '')).join('</code>, <code>')}</code>.
Gesucht wird aber exakt <code>${name}</code>.</p>
<p>Cloudflare unterscheidet <strong>Groß- und Kleinschreibung</strong>:
<code>App_Password</code> und <code>APP_PASSWORD</code> sind zwei verschiedene
Dinge. Im Dashboard sieht beides gleich richtig aus.</p>
<p><strong>Lösung:</strong> <em>Settings → Variables and secrets</em> → den
falsch geschriebenen Eintrag löschen → neu anlegen, Name in Großbuchstaben
mit Unterstrich: <code>${name}</code> → <em>Deploy</em>.</p>`
    : '';

  const diagnosis =
    nearMiss ||
    (kind === 'leer'
      ? `<p><strong>Das Geheimnis <code>${name}</code> existiert, ist aber leer.</strong>
Im Dashboard sieht es dadurch völlig normal aus – es steht „Value encrypted"
da, obwohl kein Wert hinterlegt ist. Das passiert, wenn beim Anlegen nur der
Name eingetragen und das Wertfeld leer gelassen (oder der eingefügte Text nicht
übernommen) wurde.</p>
<p><strong>Lösung:</strong> <em>Settings → Variables and secrets</em> → bei
<code>${name}</code> auf <em>Edit</em> → Wert eintragen → <em>Deploy</em>.
Am besten den Eintrag einmal ganz löschen und neu anlegen.</p>`
      : `<p>Der laufende Worker kennt das Geheimnis <code>${name}</code> nicht.
Es ist dort gar nicht angekommen.</p>
<p><strong>Achte besonders auf die Schreibweise.</strong> Der Name muss exakt
<code>${name}</code> lauten – alles groß, mit Unterstrich. Cloudflare
unterscheidet Groß- und Kleinschreibung, <code>App_Password</code> zählt also
nicht.</p>`);

  return htmlResponse(
    `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex, nofollow"/>
<title>Einrichtung unvollständig</title></head><body
style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1.5rem;line-height:1.7;color:#1a1a1a">
<h1 style="font-size:1.35rem">Einrichtung noch nicht abgeschlossen</h1>
${diagnosis}

<p style="background:#eef6ff;border-left:4px solid #3b82f6;padding:.9rem 1rem;border-radius:.3rem">
<strong>Genaue Diagnose:</strong> Öffne
<a href="/__status"><code>/__status</code></a>. Dort steht, welche Werte im
laufenden Worker wirklich ankommen – ohne die Geheimnisse selbst preiszugeben.</p>

<h2 style="font-size:1.05rem;margin-top:2rem">Weitere mögliche Ursachen</h2>
<ol>
<li><strong>Falscher Ort im Dashboard.</strong> <em>Settings → Variables and
secrets</em> ist richtig. <em>Settings → Build → Build variables and secrets</em>
ist falsch – diese Werte gelten nur beim Bauen und sind zur Laufzeit unsichtbar.</li>
<li><strong>Nicht übernommen.</strong> Nach dem Eintragen muss unten
<em>Deploy</em> geklickt werden.</li>
<li><strong>Worker doppelt vorhanden.</strong> Unter <em>Compute (Workers)</em>
prüfen. Der Name in <code>wrangler.jsonc</code> muss exakt dem Worker
entsprechen, den Du hier aufrufst.</li>
</ol>

<h2 style="font-size:1.05rem;margin-top:2rem">Wenn Du vom eigenen Rechner deployst</h2>
<pre style="background:#f4f4f4;padding:1rem;border-radius:.5rem;overflow-x:auto"><code>npx wrangler secret put ${name}</code></pre>

<p style="margin-top:2rem;color:#555">Ausführlich in der <code>ANLEITUNG.md</code>,
Abschnitt 3A (Dashboard) bzw. 3B (eigener Rechner).</p>
</body></html>`,
    503,
  );
}

/**
 * Meldet, was im laufenden Worker ankommt – Namen und Zustand, niemals Werte.
 * Bewusst so knapp, dass man das Ergebnis abtippen oder weiterschicken kann.
 */
async function handleStatus(request, env, config) {
  const inspect = (value) => ({
    vorhanden: value !== undefined && value !== null,
    typ: typeof value,
    leer: typeof value === 'string' && value.trim() === '',
    // Ein versehentlich mitkopiertes Leerzeichen oder Zeilenende lässt die
    // Anmeldung später scheitern, ohne dass man es im Dashboard sieht.
    randzeichen: typeof value === 'string' && value.length > 0 && value !== value.trim(),
  });

  // Sobald alles eingerichtet ist, gehört die Seite hinter die Anmeldung.
  if (!config.error && !(await isSignedIn(request, config))) {
    return jsonResponse({ hinweis: 'Nur für angemeldete Nutzer.' }, 401);
  }

  return jsonResponse({
    einrichtungKomplett: !config.error,
    problem: config.error ? `${config.error.name} ${config.error.kind}` : null,
    // Wenn ein Geheimnis fehlt, es aber einen fast gleich geschriebenen
    // Eintrag gibt, ist das praktisch immer die Ursache.
    fastRichtigGeschrieben: config.error?.aehnlich?.length ? config.error.aehnlich : null,
    geheimnisse: {
      APP_PASSWORD: inspect(env.APP_PASSWORD),
      SESSION_SECRET: inspect(env.SESSION_SECRET),
    },
    variablen: {
      SESSION_TTL_HOURS: env.SESSION_TTL_HOURS ?? null,
      SHARE_DEFAULT_TTL_HOURS: env.SHARE_DEFAULT_TTL_HOURS ?? null,
      SHARE_MAX_TTL_HOURS: env.SHARE_MAX_TTL_HOURS ?? null,
    },
    bindings: {
      ASSETS: Boolean(env.ASSETS),
      LOGIN_LIMITER: Boolean(env.LOGIN_LIMITER),
    },
    // Die entscheidende Zeile: alles, was der Worker an Bindings sieht.
    alleNamenImWorker: Object.keys(env).sort(),
  });
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
