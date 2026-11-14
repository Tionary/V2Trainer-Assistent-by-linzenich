/**
 * Trainer-Assistent by linzenich – Zugangsschutz vor der statischen App.
 *
 * Ablauf jeder Anfrage:
 *
 *   Browser ──▶ Worker (diese Datei)
 *                 │
 *                 ├── /login          → Anmeldeseite (Microsoft-Knopf oder Passwortfeld)
 *                 ├── /auth/start     → weiter zur Microsoft-Anmeldung
 *                 ├── /auth/callback  → Rückkehr von Microsoft, Sitzung ausstellen
 *                 ├── /logout         → Cookie löschen (und bei Microsoft abmelden)
 *                 ├── /abgemeldet     → Bestätigung nach der Abmeldung
 *                 ├── /api/me         → wer ist angemeldet?
 *                 ├── /api/share      → befristeten QR-Link erzeugen (angemeldet)
 *                 ├── /s/<token>      → eine PDF ohne Anmeldung ausliefern
 *                 └── alles andere    → nur mit gültigem Cookie an public/
 *
 * Weil in wrangler.jsonc "run_worker_first": true gesetzt ist, kommt KEINE
 * Datei aus public/ am Worker vorbei.
 *
 * Zwei Anmeldearten:
 *   • Microsoft (Entra ID) – aktiv, sobald ENTRA_TENANT_ID und ENTRA_CLIENT_ID
 *     gesetzt sind. Jede Person meldet sich mit ihrem Firmenkonto an.
 *   • Team-Passwort – der bisherige Weg, solange Entra nicht eingerichtet ist.
 */
import { renderLoginPage } from './login-page.js';
import {
  AUTH_COOKIE_NAME,
  COOKIE_NAME,
  createAuthFlowToken,
  createSessionToken,
  createShareToken,
  createUserSessionToken,
  verifyAuthFlowToken,
  verifySessionToken,
  verifyShareToken,
  verifyUserSessionToken,
} from './tokens.js';
import { passwordMatches } from './crypto.js';
import {
  EntraError,
  GUID_PATTERN,
  authorizeUrl,
  createAuthRequest,
  describeMicrosoftError,
  logoutUrl,
  redeemCode,
} from './entra.js';

/** So lange darf zwischen "Anmelden" und der Rückkehr von Microsoft liegen. */
const AUTH_FLOW_TTL_SECONDS = 600;

/**
 * Dateien, die auch ohne Anmeldung nötig sind – sie tragen keine Inhalte.
 *
 * manifest.webmanifest und /icons/ gehören dazu, weil der Browser sie beim
 * Ablegen auf dem Startbildschirm ohne Anmelde-Cookie anfordert. Stünden sie
 * hinter dem Login, bekäme er die Anmeldeseite zurück – die Verknüpfung
 * erhielte dann ein leeres Symbol und einen falschen Namen.
 *
 * sw.js ist ebenfalls frei erreichbar: Der Browser prüft den Service Worker
 * regelmäßig im Hintergrund, auch mit abgelaufener Sitzung. Bekäme er dabei
 * HTML statt JavaScript, würde er die Registrierung verwerfen.
 */
const PUBLIC_FILES = new Set([
  '/trainer-assistent-logo.png',
  '/by-linzenich-weiss.png',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/sw.js',
]);
const PUBLIC_PREFIXES = ['/fonts/', '/icons/'];

/** Nur PDFs aus diesem Ordner dürfen per QR-Code freigegeben werden. */
const SHARE_ROOT = '/dokumente/';

/**
 * Präfix im Freigabe-Token für PDFs, die ein Modul im Browser erzeugt hat
 * (Trainingsplan, FMS-Bericht, PWC-Auswertung, Food-Swap-Plan). Sie liegen
 * nicht in public/, sondern befristet im KV-Speicher SHARE_STORE.
 */
const STORE_PREFIX = 'ablage:';

/** Obergrenze für eine hochgeladene PDF. Ein Bericht wiegt real 0,2–2 MB. */
const MAX_SHARE_BYTES = 10 * 1024 * 1024;

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    // Die Abmeldung leitet nach dem Absenden zu Microsoft weiter; auch diese
    // Weiterleitung muss form-action erlauben.
    "form-action 'self' https://login.microsoftonline.com",
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
  if (path === '/auth/start') return handleAuthStart(request, url, config);
  if (path === '/auth/callback') return handleAuthCallback(request, url, config);
  if (path === '/abgemeldet') return handleSignedOut(url, config);
  if (path === '/logout') return handleLogout(request, url, config);
  if (path === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const session = await readSession(request, config);
  const signedIn = Boolean(session);

  if (path === '/api/me') {
    if (!signedIn) return jsonResponse({ error: 'Nicht angemeldet' }, 401);
    return jsonResponse({
      modus: session.user ? 'microsoft' : 'passwort',
      name: session.user?.name || null,
      benutzer: session.user?.username || null,
      rollen: session.user?.roles || [],
    });
  }

  if (path === '/api/share') {
    if (!signedIn) return jsonResponse({ error: 'Nicht angemeldet' }, 401);
    return handleCreateShare(request, env, url, config);
  }

  if (path === '/api/share-file') {
    if (!signedIn) return jsonResponse({ error: 'Nicht angemeldet' }, 401);
    return handleUploadShare(request, env, url, config);
  }

  if (!signedIn && !isPubliclyReadable(path)) return requireLogin(request, url);

  return serveAsset(request, env);
}

/* ───────────────────────────── Anmeldung ─────────────────────────────── */

async function handleLogin(request, env, url, config) {
  const next = safeNext(url.searchParams.get('next'));

  if (request.method !== 'POST' || !config.passwordEnabled) {
    // Wer schon angemeldet ist, braucht das Formular nicht.
    if (await readSession(request, config)) return redirect(next);
    return htmlResponse(loginPage(config, { next }));
  }

  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const target = safeNext(String(form.get('next') ?? '/'));

  if (!(await withinLoginRateLimit(request, env))) {
    return htmlResponse(
      loginPage(config, {
        next: target,
        error: 'Zu viele Versuche. Bitte warte eine Minute und probiere es erneut.',
      }),
      429,
    );
  }

  if (!(await passwordMatches(config.sessionSecret, password, config.appPassword))) {
    return htmlResponse(
      loginPage(config, { next: target, error: 'Das Passwort stimmt nicht.' }),
      401,
    );
  }

  const token = await createSessionToken(
    config.sessionSecret,
    config.appPassword,
    config.passwordSessionTtlHours,
  );
  const response = redirect(target);
  response.headers.set('Set-Cookie', sessionCookie(token, config.passwordSessionTtlHours * 3600));
  return response;
}

/** Schickt den Browser zur Microsoft-Anmeldung. */
async function handleAuthStart(request, url, config) {
  if (!config.entra) return redirect('/login');
  if (request.method !== 'GET') return redirect('/login');

  const next = safeNext(url.searchParams.get('next'));
  const auth = await createAuthRequest();
  const flowToken = await createAuthFlowToken(
    config.sessionSecret,
    { s: auth.state, n: auth.nonce, v: auth.verifier, x: next },
    AUTH_FLOW_TTL_SECONDS,
  );

  const response = redirect(authorizeUrl(config.entra, callbackUrl(url), auth));
  response.headers.append('Set-Cookie', authFlowCookie(flowToken, AUTH_FLOW_TTL_SECONDS));
  return response;
}

/** Rückkehr von Microsoft: Code einlösen, prüfen, Sitzung ausstellen. */
async function handleAuthCallback(request, url, config) {
  if (!config.entra) return redirect('/login');

  const fail = (message, status = 401) => {
    const response = htmlResponse(loginPage(config, { error: message }), status);
    response.headers.append('Set-Cookie', authFlowCookie('', 0));
    return response;
  };

  const params = url.searchParams;
  if (params.get('error')) {
    const description = params.get('error_description') || '';
    if (params.get('error') === 'access_denied' && !/AADSTS/.test(description)) {
      return fail('Die Anmeldung wurde abgebrochen.');
    }
    return fail(describeMicrosoftError(description), 403);
  }

  const flow = await verifyAuthFlowToken(
    config.sessionSecret,
    readCookie(request.headers.get('Cookie'), AUTH_COOKIE_NAME),
  );
  const code = params.get('code');
  if (!flow || !code || typeof flow.s !== 'string' || flow.s !== params.get('state')) {
    return fail(
      'Die Anmeldung ist abgelaufen oder wurde in einem anderen Fenster gestartet. Bitte noch einmal auf „Mit Microsoft anmelden" tippen.',
      400,
    );
  }

  let user;
  try {
    user = await redeemCode(config.entra, {
      code,
      redirectUri: callbackUrl(url),
      verifier: flow.v,
      nonce: flow.n,
    });
  } catch (error) {
    if (error instanceof EntraError) {
      console.warn('Microsoft-Anmeldung abgelehnt:', error.code, error.message);
      return fail(error.message);
    }
    console.error('Microsoft-Anmeldung fehlgeschlagen:', error);
    return fail('Microsoft ist gerade nicht erreichbar. Bitte in einer Minute erneut versuchen.', 502);
  }

  if (!hasAllowedRole(user, config)) {
    console.warn('Anmeldung ohne passende Rolle:', user.username, user.roles);
    return fail(
      `Das Konto ${user.username || ''} ist bei Microsoft angemeldet, hat aber keine Rolle für den Trainer-Assistenten. ` +
        'Bitte wende Dich an die Personal-Training-Leitung.',
      403,
    );
  }

  const token = await createUserSessionToken(config.sessionSecret, user, config.entraSessionTtlHours);
  const response = redirect(safeNext(flow.x));
  response.headers.append('Set-Cookie', sessionCookie(token, config.entraSessionTtlHours * 3600));
  response.headers.append('Set-Cookie', authFlowCookie('', 0));
  return response;
}

function handleSignedOut(url, config) {
  if (!config.entra) return redirect('/login');
  return htmlResponse(loginPage(config, { notice: 'Du bist abgemeldet – hier und bei Microsoft.' }));
}

async function handleLogout(request, url, config) {
  if (request.method !== 'POST') return redirect('/');
  // Wer mit Microsoft angemeldet war, wird auch dort abgemeldet. Sonst meldet
  // "Anmelden" auf einem gemeinsam genutzten Tablet ohne Rückfrage wieder
  // dieselbe Person an. Wer mit dem Team-Passwort drin war, landet wie bisher
  // auf der Anmeldeseite.
  const session = await readSession(request, config);
  const response = redirect(
    session?.user && config.entra ? logoutUrl(config.entra, `${url.origin}/abgemeldet`) : '/login',
  );
  response.headers.set('Set-Cookie', sessionCookie('', 0));
  return response;
}

/**
 * Liest die Sitzung aus dem Cookie.
 * Rückgabe: { user } bei gültiger Sitzung – user ist bei einer
 * Microsoft-Anmeldung die Person, bei Team-Passwort null –, sonst null.
 */
async function readSession(request, config) {
  const token = readCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (!token) return null;

  if (token.startsWith('u1.')) {
    if (!config.entra) return null;
    const user = await verifyUserSessionToken(config.sessionSecret, token);
    // Die Rolle wird bei jeder Anfrage erneut geprüft: Wird die Liste der
    // erlaubten Rollen verkleinert, wirkt das sofort.
    return user && hasAllowedRole(user, config) ? { user } : null;
  }

  // Passwort-Sitzungen gelten nur, solange das Passwort erlaubt ist. Mit dem
  // Wechsel auf ANMELDUNG = "microsoft" enden sie sofort.
  if (!config.passwordEnabled) return null;
  return (await verifySessionToken(config.sessionSecret, config.appPassword, token))
    ? { user: null }
    : null;
}

function hasAllowedRole(user, config) {
  if (config.allowedRoles === null) return true; // "*" = jede angemeldete Person der Firma
  return user.roles.some((role) => config.allowedRoles.includes(role));
}

/** Anmeldeseite passend zur eingestellten Stufe. */
function loginPage(config, options) {
  const mode = { passwort: 'passwort', beide: 'beide', microsoft: 'microsoft' }[config.loginMode];
  return renderLoginPage({ ...options, mode });
}

function callbackUrl(url) {
  return `${url.origin}/auth/callback`;
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

  const ttlHours = clampTtl(body?.ttlHours, config);

  const { token, expiresAt } = await createShareToken(config.sessionSecret, file, ttlHours);

  return jsonResponse({
    url: `${url.origin}/s/${token}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    ttlHours,
  });
}

/**
 * Nimmt eine PDF entgegen, die ein Modul gerade im Browser erzeugt hat, legt
 * sie befristet ab und gibt den QR-Link zurück.
 *
 * Warum überhaupt eine Ablage? Ein QR-Code fasst rund 2 KB – eine PDF wiegt
 * das Tausendfache. Der Code kann also nur einen Link tragen, und der Link
 * braucht etwas, worauf er zeigt. Der Eintrag löscht sich nach Ablauf der
 * gewählten Gültigkeit von selbst; niemand muss aufräumen.
 */
async function handleUploadShare(request, env, url, config) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Nur POST' }, 405);

  if (!env.SHARE_STORE) {
    return jsonResponse(
      {
        error:
          'Die Ablage für erzeugte PDFs ist noch nicht eingerichtet. ' +
          'Ein einmaliger Schritt: In Cloudflare unter „Storage & Databases → KV" ' +
          'einen Namespace anlegen und ihn in wrangler.jsonc als SHARE_STORE ' +
          'eintragen. Die Anleitung beschreibt das in Abschnitt 5.2. ' +
          'Herunterladen und Ausdrucken funktioniert unabhängig davon.',
        code: 'ablage-fehlt',
      },
      503,
    );
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return jsonResponse({ error: 'Es kam keine Datei an.' }, 400);
  if (body.byteLength > MAX_SHARE_BYTES) {
    return jsonResponse({ error: 'Diese PDF ist zu groß für einen QR-Code-Link.' }, 413);
  }

  // Nur echte PDFs – erkennbar an den ersten fünf Zeichen "%PDF-".
  const head = new TextDecoder('latin1').decode(new Uint8Array(body, 0, 5));
  if (head !== '%PDF-') return jsonResponse({ error: 'Das ist keine PDF-Datei.' }, 415);

  const name = safeFileName(url.searchParams.get('name'));
  const ttlHours = clampTtl(url.searchParams.get('ttlHours'), config);

  const id = crypto.randomUUID().replace(/-/g, '');
  await env.SHARE_STORE.put(id, body, {
    // Cloudflare räumt den Eintrag exakt dann weg, wenn der QR-Code abläuft.
    expirationTtl: Math.max(60, Math.round(ttlHours * 3600)),
    metadata: { name },
  });

  const { token, expiresAt } = await createShareToken(
    config.sessionSecret,
    `${STORE_PREFIX}${id}`,
    ttlHours,
  );

  return jsonResponse({
    url: `${url.origin}/s/${token}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    ttlHours,
  });
}

/** Hält die gewünschte Gültigkeit innerhalb der erlaubten Spanne. */
function clampTtl(value, config) {
  const requested = Number(value ?? config.shareDefaultTtlHours);
  if (!Number.isFinite(requested)) return config.shareDefaultTtlHours;
  return Math.min(Math.max(requested, 1), config.shareMaxTtlHours);
}

/**
 * Macht aus einem beliebigen Vorschlag einen Dateinamen, der gefahrlos in
 * einen Content-Disposition-Header passt – keine Anführungszeichen, keine
 * Zeilenumbrüche, keine Pfadtrenner.
 */
function safeFileName(value) {
  const raw = typeof value === 'string' ? value : '';
  const cleaned = raw
    .replace(/[\\/\r\n"]/g, '')
    .replace(/[^\w äöüÄÖÜß.()+-]/g, '')
    .trim()
    .slice(0, 120);
  if (!cleaned || !/\.pdf$/i.test(cleaned)) return 'Bericht.pdf';
  return cleaned;
}

async function handleShareLink(request, env, url, config) {
  const token = url.pathname.slice('/s/'.length);
  const file = await verifyShareToken(config.sessionSecret, token);

  if (!file) return htmlResponse(renderShareExpiredPage(), 410);

  // Im Browser erzeugte PDF: liegt in der befristeten Ablage.
  if (file.startsWith(STORE_PREFIX)) {
    return serveStoredShare(request, env, file.slice(STORE_PREFIX.length));
  }

  if (!normalizeSharePath(file)) return htmlResponse(renderShareExpiredPage(), 410);

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

/** Liefert eine PDF aus der befristeten Ablage aus. */
async function serveStoredShare(request, env, id) {
  if (!env.SHARE_STORE || !/^[0-9a-f]{32}$/.test(id)) {
    return htmlResponse(renderShareExpiredPage(), 410);
  }

  const stored = await env.SHARE_STORE.getWithMetadata(id, { type: 'arrayBuffer' });
  // Kein Eintrag mehr: abgelaufen und von Cloudflare gelöscht.
  if (!stored?.value) return htmlResponse(renderShareExpiredPage(), 410);

  const name = safeFileName(stored.metadata?.name);
  return new Response(request.method === 'HEAD' ? null : stored.value, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(stored.value.byteLength),
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
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

  // Ohne den korrekten Typ wertet der Browser das Manifest nicht aus und
  // bietet die Installation gar nicht erst an. Die Endung .webmanifest ist
  // nicht überall hinterlegt, deshalb wird der Typ hier ausdrücklich gesetzt.
  if (path === '/manifest.webmanifest') {
    response.headers.set('Content-Type', 'application/manifest+json; charset=utf-8');
  }

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

/** Prüft eine Klartext-Variable, die eine Microsoft-ID (GUID) enthalten muss. */
function inspectGuidVariable(value, name) {
  if (!value) return { name, kind: 'variable-fehlt', aehnlich: [] };
  if (!GUID_PATTERN.test(value)) return { name, kind: 'ungueltig', aehnlich: [] };
  return null;
}

/** Die drei Stufen der Einstellung ANMELDUNG. */
const LOGIN_MODES = ['passwort', 'beide', 'microsoft'];

function readConfig(env) {
  const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const loginMode = String(env.ANMELDUNG ?? 'passwort').trim().toLowerCase();
  if (!LOGIN_MODES.includes(loginMode)) {
    return { error: { name: 'ANMELDUNG', kind: 'ungueltige-stufe', aehnlich: [] } };
  }

  const tenantId = String(env.ENTRA_TENANT_ID ?? '').trim().toLowerCase();
  const clientId = String(env.ENTRA_CLIENT_ID ?? '').trim().toLowerCase();
  const entraProblem =
    inspectGuidVariable(tenantId, 'ENTRA_TENANT_ID') ||
    inspectGuidVariable(clientId, 'ENTRA_CLIENT_ID') ||
    inspectSecret(env, 'ENTRA_CLIENT_SECRET');

  // Stufe "passwort": Eine halb fertige Microsoft-Einrichtung darf die
  // laufende Seite nie lahmlegen – Microsoft bleibt dann einfach aus.
  // Stufen "beide" und "microsoft": Ohne vollständige Einrichtung geht nichts.
  if (loginMode !== 'passwort' && entraProblem) return { error: entraProblem, loginMode };

  const passwordEnabled = loginMode !== 'microsoft';
  const problem =
    (passwordEnabled && inspectSecret(env, 'APP_PASSWORD')) || inspectSecret(env, 'SESSION_SECRET');
  if (problem) return { error: problem, loginMode };

  const rolesSetting = String(env.ENTRA_ALLOWED_ROLES ?? 'Trainer,Admin').trim();
  return {
    loginMode,
    sessionSecret: env.SESSION_SECRET,
    shareDefaultTtlHours: number(env.SHARE_DEFAULT_TTL_HOURS, 72),
    shareMaxTtlHours: number(env.SHARE_MAX_TTL_HOURS, 720),

    passwordEnabled,
    appPassword: passwordEnabled ? env.APP_PASSWORD : null,
    passwordSessionTtlHours: number(env.SESSION_TTL_HOURS, 720),

    // In Stufe "passwort" ist Microsoft eingerichtet, aber unsichtbar: kein
    // Knopf auf der Anmeldeseite. Über /auth/start lässt es sich trotzdem
    // schon ausprobieren (Probelauf vor der Ankündigung im Team).
    entra: entraProblem ? null : { tenantId, clientId, clientSecret: env.ENTRA_CLIENT_SECRET },
    entraProblem: entraProblem ? `${entraProblem.name} ${entraProblem.kind}` : null,
    allowedRoles:
      rolesSetting === '*'
        ? null
        : rolesSetting
            .split(',')
            .map((role) => role.trim())
            .filter(Boolean),
    entraSessionTtlHours: number(env.ENTRA_SESSION_TTL_HOURS, 168),
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

  const variableHint =
    kind === 'variable-fehlt' || kind === 'ungueltig'
      ? `<p><strong>${
          kind === 'ungueltig'
            ? `<code>${name}</code> ist eingetragen, hat aber nicht das Format einer Microsoft-ID.`
            : `<code>${name}</code> fehlt.`
        }</strong> Für die Microsoft-Anmeldung braucht der Worker beide IDs aus
Microsoft Entra: <code>ENTRA_TENANT_ID</code> (Verzeichnis-ID) und
<code>ENTRA_CLIENT_ID</code> (Anwendungs-ID). Beide sehen so aus:
<code>1a2b3c4d-1234-5678-9abc-0123456789ab</code>.</p>
<p><strong>Lösung:</strong> In <code>wrangler.jsonc</code> unter <code>vars</code>
beide Werte aus der Übersichtsseite der App-Registrierung eintragen und
veröffentlichen. Anleitung: <code>ANLEITUNG-MICROSOFT-LOGIN.md</code>, Schritt 3 und 11.</p>
<p>Wer die Microsoft-Anmeldung vorerst nicht nutzen will, setzt
<code>ANMELDUNG</code> in <code>wrangler.jsonc</code> auf <code>"passwort"</code> –
dann gilt wieder nur das Team-Passwort.</p>`
      : kind === 'ungueltige-stufe'
        ? `<p><strong><code>ANMELDUNG</code> hat einen unbekannten Wert.</strong>
Erlaubt sind genau drei Wörter: <code>"passwort"</code>, <code>"beide"</code>
oder <code>"microsoft"</code> (in <code>wrangler.jsonc</code> unter <code>vars</code>).</p>`
        : '';

  const diagnosis =
    nearMiss ||
    variableHint ||
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

<p style="background:#fff4e5;border-left:4px solid #f59e0b;padding:.9rem 1rem;border-radius:.3rem">
<strong>Die mit Abstand häufigste Ursache: falscher Typ.</strong> Beim Anlegen
im Dashboard steht der Typ standardmäßig auf <em>Text</em>. Eine Text-Variable
wird bei jedem Deploy aus der <code>wrangler.jsonc</code> heraus neu gesetzt –
und dabei gelöscht, weil das Passwort dort (zu Recht) nicht steht. Es
funktioniert also kurz und ist nach dem nächsten Build spurlos weg.</p>

<p><strong>Lösung – die Reihenfolge ist wichtig:</strong></p>
<ol>
<li>Vorhandenen Eintrag <code>${name}</code> komplett <strong>löschen</strong>.</li>
<li><em>Add variable</em> → <strong>zuerst</strong> den Typ auf <em>Secret</em>
stellen, <strong>dann</strong> Name und Wert eintragen. Ein nachträglicher
Wechsel von <em>Text</em> auf <em>Secret</em> übernimmt den alten Wert nicht.</li>
<li><em>Deploy</em> klicken.</li>
</ol>

<p>Achte außerdem auf die Schreibweise: exakt <code>${name}</code>, alles groß,
mit Unterstrich. Cloudflare unterscheidet Groß- und Kleinschreibung.</p>`);

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
  const session = config.error ? null : await readSession(request, config);
  if (!config.error && !session) {
    return jsonResponse({ hinweis: 'Nur für angemeldete Nutzer.' }, 401);
  }

  const origin = new URL(request.url).origin;
  const guidState = (value) => {
    const text = String(value ?? '').trim();
    return { vorhanden: text !== '', formatGueltig: GUID_PATTERN.test(text) };
  };

  return jsonResponse({
    einrichtungKomplett: !config.error,
    anmeldung: {
      passwort: 'Team-Passwort (Microsoft unsichtbar)',
      beide: 'Team-Passwort, Microsoft als zusätzliche Option',
      microsoft: 'Nur Microsoft',
    }[config.loginMode ?? String(env.ANMELDUNG ?? 'passwort').trim().toLowerCase()] ?? 'ungültige Stufe',
    ANMELDUNG: env.ANMELDUNG ?? null,
    angemeldetAls: session?.user ? { name: session.user.name, benutzer: session.user.username, rollen: session.user.roles } : null,
    problem: config.error ? `${config.error.name} ${config.error.kind}` : null,
    microsoft: {
      eingerichtet: Boolean(config.entra),
      problem: config.entraProblem ?? null,
      ENTRA_TENANT_ID: guidState(env.ENTRA_TENANT_ID),
      ENTRA_CLIENT_ID: guidState(env.ENTRA_CLIENT_ID),
      ENTRA_CLIENT_SECRET: inspect(env.ENTRA_CLIENT_SECRET),
      ENTRA_ALLOWED_ROLES: env.ENTRA_ALLOWED_ROLES ?? null,
      ENTRA_SESSION_TTL_HOURS: env.ENTRA_SESSION_TTL_HOURS ?? null,
      // Genau diese beiden Adressen müssen in Entra als Umleitungs-URI stehen.
      umleitungsUrisFuerEntra: [`${origin}/auth/callback`, `${origin}/abgemeldet`],
    },
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
      // Ohne SHARE_STORE bleibt der QR-Knopf in den Modulen wirkungslos –
      // Herunterladen und Ausdrucken funktionieren aber weiterhin.
      SHARE_STORE: Boolean(env.SHARE_STORE),
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

/**
 * Kurzlebiges Cookie für die Minuten der Microsoft-Anmeldung. Nur unter /auth
 * sichtbar. SameSite=Lax genügt: Die Rückkehr von Microsoft ist eine normale
 * Seitennavigation (GET), bei der Lax-Cookies mitgeschickt werden.
 */
function authFlowCookie(value, maxAgeSeconds) {
  return [
    `${AUTH_COOKIE_NAME}=${value}`,
    'Path=/auth',
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
