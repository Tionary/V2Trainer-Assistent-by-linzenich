/**
 * Ausstellen und Prüfen der beiden Token-Arten:
 *
 *  1. Sitzungs-Token  – liegt im Cookie, beweist "hat das Passwort gekannt".
 *  2. Freigabe-Token  – steckt in der QR-Code-URL, erlaubt genau eine PDF
 *                       für eine begrenzte Zeit, ganz ohne Anmeldung.
 *
 * Beide sind mit SESSION_SECRET signiert, tragen aber unterschiedliche
 * Präfixe ("session|" / "share|"). So kann ein Token der einen Art niemals
 * als Token der anderen Art durchgehen.
 */
import {
  base64UrlDecodeText,
  base64UrlEncode,
  base64UrlEncodeText,
  constantTimeEqual,
  hmac,
  passwordFingerprint,
} from './crypto.js';

export const COOKIE_NAME = 'ta_session';

/* ───────────────────────────── Sitzung ───────────────────────────── */

export async function createSessionToken(secret, password, ttlHours) {
  const expiresAt = Date.now() + ttlHours * 3600 * 1000;
  const fingerprint = await passwordFingerprint(password);
  const payload = `${expiresAt}.${fingerprint}`;
  const signature = await hmac(secret, `session|v1|${payload}`);
  return `${payload}.${base64UrlEncode(signature)}`;
}

export async function verifySessionToken(secret, password, token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expiresAt, fingerprint, signature] = parts;
  const expiryMs = Number(expiresAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) return false;

  // Passwort geändert? Dann ist der Fingerabdruck veraltet.
  if (fingerprint !== (await passwordFingerprint(password))) return false;

  const expected = await hmac(secret, `session|v1|${expiresAt}.${fingerprint}`);
  return safeCompareSignature(signature, expected);
}

/* ─────────────────────────── QR-Freigabe ─────────────────────────── */

/**
 * Freigabe-Token für genau einen Pfad unterhalb von /dokumente/.
 * Bewusst NICHT an den Passwort-Fingerabdruck gebunden: Ein bereits
 * ausgedruckter QR-Code soll weiter funktionieren, wenn intern das
 * Mitarbeiter-Passwort gewechselt wird.
 */
export async function createShareToken(secret, path, ttlHours) {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.round(ttlHours * 3600);
  const payload = base64UrlEncodeText(`${expiresAt}|${path}`);
  const signature = await hmac(secret, `share|v1|${payload}`);
  return { token: `${payload}.${base64UrlEncode(signature)}`, expiresAt };
}

/** Gibt bei Erfolg den freigegebenen Pfad zurück, sonst null. */
export async function verifyShareToken(secret, token) {
  if (typeof token !== 'string') return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = await hmac(secret, `share|v1|${payload}`);
  if (!safeCompareSignature(signature, expected)) return null;

  let decoded;
  try {
    decoded = base64UrlDecodeText(payload);
  } catch {
    return null;
  }

  const divider = decoded.indexOf('|');
  if (divider <= 0) return null;

  const expiresAt = Number(decoded.slice(0, divider));
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;

  return decoded.slice(divider + 1);
}

/* ──────────────────────────── intern ─────────────────────────────── */

/** Vergleicht eine Base64url-Signatur mit den erwarteten Rohbytes. */
function safeCompareSignature(candidate, expectedBytes) {
  // Der Vergleich läuft über die Textform: gleiche Länge, keine Ausnahmen
  // durch fehlerhaftes Base64 im Eingabewert.
  const expected = base64UrlEncode(expectedBytes);
  if (candidate.length !== expected.length) return false;
  return constantTimeEqual(
    Uint8Array.from(candidate, (c) => c.charCodeAt(0)),
    Uint8Array.from(expected, (c) => c.charCodeAt(0)),
  );
}
