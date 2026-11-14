/**
 * Anmeldung mit Microsoft Entra ID (OpenID Connect, Authorization Code Flow
 * mit PKCE).
 *
 * Ablauf:
 *
 *   1. /auth/start      → Browser wird zu login.microsoftonline.com geschickt.
 *                         Zufallswerte (state, nonce, PKCE-Verifier) liegen
 *                         solange in einem kurzlebigen, signierten Cookie.
 *   2. Microsoft        → Mitarbeiter meldet sich mit dem Firmenkonto an.
 *   3. /auth/callback   → Worker tauscht den Einmal-Code gegen ein ID-Token,
 *                         prüft dessen Signatur und Inhalt und stellt eine
 *                         eigene Sitzung aus.
 *
 * Der Worker spricht dafür nur mit zwei Adressen bei Microsoft: dem
 * Token-Endpunkt und der Liste der öffentlichen Signaturschlüssel.
 */
import { base64UrlDecode, base64UrlDecodeText, base64UrlEncode } from './crypto.js';

const LOGIN_HOST = 'https://login.microsoftonline.com';

/** Erlaubte Abweichung der Uhren zwischen Microsoft und Cloudflare. */
const CLOCK_SKEW_SECONDS = 300;

/** Öffentliche Schlüssel von Microsoft je Mandant, zwischengespeichert pro Isolate. */
const jwksCache = new Map();
const JWKS_MAX_AGE_MS = 6 * 3600 * 1000;

export const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─────────────────────────── Anmeldung starten ─────────────────────────── */

/** Erzeugt die Zufallswerte für einen Anmeldevorgang. */
export async function createAuthRequest() {
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const challenge = base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  return { state, nonce, verifier, challenge };
}

export function authorizeUrl(entra, redirectUri, { state, nonce, challenge }) {
  const url = new URL(`${LOGIN_HOST}/${entra.tenantId}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: entra.clientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Auf gemeinsam genutzten Studio-Tablets soll immer gefragt werden, mit
    // welchem Konto angemeldet wird – sonst landet man still im Konto des
    // Vorgängers.
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export function logoutUrl(entra, postLogoutRedirectUri) {
  const url = new URL(`${LOGIN_HOST}/${entra.tenantId}/oauth2/v2.0/logout`);
  url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  return url.toString();
}

/* ───────────────────────── Code gegen Token tauschen ───────────────────── */

/**
 * Tauscht den Einmal-Code gegen ein ID-Token und prüft es vollständig.
 * Gibt bei Erfolg die Person zurück, sonst wirft es einen EntraError.
 */
export async function redeemCode(entra, { code, redirectUri, verifier, nonce }) {
  const response = await fetch(`${LOGIN_HOST}/${entra.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: entra.clientId,
      client_secret: entra.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: 'openid profile email',
    }),
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new EntraError('token-antwort', 'Microsoft hat keine lesbare Antwort geschickt.');
  }
  if (!response.ok || typeof body?.id_token !== 'string') {
    throw new EntraError('token-abgelehnt', describeMicrosoftError(body?.error_description || body?.error));
  }

  const claims = await verifyIdToken(entra, body.id_token, nonce);
  return {
    id: claims.oid,
    name: typeof claims.name === 'string' ? claims.name : '',
    username: typeof claims.preferred_username === 'string' ? claims.preferred_username : '',
    roles: Array.isArray(claims.roles) ? claims.roles.filter((r) => typeof r === 'string') : [],
  };
}

/**
 * Prüft Signatur, Aussteller, Empfänger, Mandant, Gültigkeit und Nonce eines
 * ID-Tokens. Exportiert, damit die Prüfung einzeln getestet werden kann.
 */
export async function verifyIdToken(entra, idToken, expectedNonce, now = Date.now()) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new EntraError('token-format', 'Das Anmelde-Token ist beschädigt.');

  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecodeText(parts[0]));
    claims = JSON.parse(base64UrlDecodeText(parts[1]));
  } catch {
    throw new EntraError('token-format', 'Das Anmelde-Token ist beschädigt.');
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new EntraError('token-signatur', 'Das Anmelde-Token ist nicht korrekt signiert.');
  }

  const key = await signingKey(entra.tenantId, header.kid);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new EntraError('token-signatur', 'Das Anmelde-Token ist nicht korrekt signiert.');

  const nowSeconds = Math.floor(now / 1000);
  const expectedIssuer = `${LOGIN_HOST}/${entra.tenantId}/v2.0`;

  if (claims.iss !== expectedIssuer || claims.tid !== entra.tenantId) {
    throw new EntraError('fremder-mandant', 'Dieses Konto gehört nicht zur Linzenich Gruppe.');
  }
  if (claims.aud !== entra.clientId) {
    throw new EntraError('token-empfaenger', 'Das Anmelde-Token war für eine andere Anwendung bestimmt.');
  }
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new EntraError('token-abgelaufen', 'Die Anmeldung hat zu lange gedauert. Bitte noch einmal.');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new EntraError('token-zukunft', 'Das Anmelde-Token ist noch nicht gültig. Bitte noch einmal.');
  }
  if (!expectedNonce || claims.nonce !== expectedNonce) {
    throw new EntraError('token-nonce', 'Die Anmeldung passt nicht zu diesem Browser. Bitte noch einmal.');
  }
  if (typeof claims.oid !== 'string' || !GUID_PATTERN.test(claims.oid)) {
    throw new EntraError('token-format', 'Im Anmelde-Token fehlt die Kennung des Kontos.');
  }
  return claims;
}

/* ─────────────────────────────── Fehler ────────────────────────────────── */

export class EntraError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Übersetzt die häufigsten Microsoft-Fehlercodes (AADSTS…) in Sätze, mit
 * denen Mitarbeitende und die IT etwas anfangen können.
 */
export function describeMicrosoftError(description) {
  const text = typeof description === 'string' ? description : '';
  const code = (text.match(/AADSTS\d+/) || [])[0] || '';
  const known = {
    AADSTS50105:
      'Dein Microsoft-Konto ist für den Trainer-Assistenten nicht freigeschaltet. Bitte wende Dich an die Personal-Training-Leitung.',
    AADSTS50011:
      'Die Rücksprungadresse ist in Microsoft Entra nicht eingetragen (Einrichtungsfehler, Anleitung Schritt 4).',
    AADSTS700016:
      'Die Anwendung ist in diesem Microsoft-Mandanten nicht bekannt. ENTRA_TENANT_ID oder ENTRA_CLIENT_ID stimmen nicht.',
    AADSTS7000215:
      'Der geheime Clientschlüssel ist falsch. Häufigste Ursache: Es wurde die „Geheimnis-ID“ statt des „Werts“ eingetragen.',
    AADSTS7000222:
      'Der geheime Clientschlüssel ist abgelaufen. Er muss in Microsoft Entra erneuert werden (Anleitung Abschnitt „Schlüssel erneuern“).',
    AADSTS65001: 'Die Administratorzustimmung für die Anwendung fehlt (Anleitung Schritt 6).',
    AADSTS50020: 'Dieses Konto gehört nicht zur Linzenich Gruppe.',
    AADSTS54005: 'Der Anmeldecode wurde schon verwendet. Bitte noch einmal anmelden.',
    AADSTS70008: 'Der Anmeldecode ist abgelaufen. Bitte noch einmal anmelden.',
  };
  if (known[code]) return known[code];
  return code
    ? `Microsoft hat die Anmeldung abgelehnt (${code}).`
    : 'Microsoft hat die Anmeldung abgelehnt.';
}

/* ──────────────────────────────── intern ───────────────────────────────── */

async function signingKey(tenantId, kid) {
  let entry = jwksCache.get(tenantId);
  const stale = !entry || Date.now() - entry.fetchedAt > JWKS_MAX_AGE_MS;

  // Unbekannte Schlüssel-ID: Microsoft hat die Schlüssel gewechselt → neu laden.
  if (stale || !entry.keys.has(kid)) {
    entry = await loadJwks(tenantId);
    jwksCache.set(tenantId, entry);
  }

  const jwk = entry.keys.get(kid);
  if (!jwk) throw new EntraError('token-signatur', 'Der Signaturschlüssel des Anmelde-Tokens ist unbekannt.');

  if (!jwk.cryptoKey) {
    jwk.cryptoKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  }
  return jwk.cryptoKey;
}

async function loadJwks(tenantId) {
  const response = await fetch(`${LOGIN_HOST}/${tenantId}/discovery/v2.0/keys`);
  if (!response.ok) {
    throw new EntraError('schluessel', 'Die Signaturschlüssel von Microsoft konnten nicht geladen werden.');
  }
  const data = await response.json();
  const keys = new Map();
  for (const key of Array.isArray(data?.keys) ? data.keys : []) {
    if (key?.kty === 'RSA' && typeof key.kid === 'string' && key.n && key.e) {
      keys.set(key.kid, { n: key.n, e: key.e });
    }
  }
  return { keys, fetchedAt: Date.now() };
}

function randomToken(bytes) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}
