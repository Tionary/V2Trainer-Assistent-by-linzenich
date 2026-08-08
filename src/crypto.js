/**
 * Kryptografische Hilfsfunktionen für Sitzungs- und QR-Freigabe-Tokens.
 *
 * Grundprinzip: Der Worker speichert nirgends eine Sitzungsliste. Stattdessen
 * bekommt der Browser ein Token, das mit SESSION_SECRET signiert ist. Ohne
 * Kenntnis des Secrets lässt sich kein gültiges Token erzeugen.
 */

const encoder = new TextEncoder();

/** Importierte HMAC-Schlüssel je Secret zwischenspeichern (pro Isolate). */
const keyCache = new Map();

async function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    keyCache.set(secret, key);
  }
  return key;
}

/** HMAC-SHA256 über `message`, als Rohbytes. */
export async function hmac(secret, message) {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Vergleich ohne zeitliche Seitenkanäle (Laufzeit unabhängig vom Inhalt). */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function base64UrlEncodeText(text) {
  return base64UrlEncode(encoder.encode(text));
}

export function base64UrlDecodeText(text) {
  return new TextDecoder().decode(base64UrlDecode(text));
}

/**
 * Kurzer Fingerabdruck des aktuellen Passworts. Er steckt in jedem
 * Sitzungs-Token: Wird das Passwort geändert, passt der Fingerabdruck nicht
 * mehr und alle bestehenden Sitzungen sind sofort ungültig.
 */
export async function passwordFingerprint(password) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(password)));
  return base64UrlEncode(digest.subarray(0, 8));
}

/**
 * Passwortvergleich über HMACs. Dadurch sind die verglichenen Werte immer
 * 32 Byte lang und die Länge des eingegebenen Passworts verrät nichts.
 */
export async function passwordMatches(secret, given, expected) {
  const [a, b] = await Promise.all([
    hmac(secret, `password|${given}`),
    hmac(secret, `password|${expected}`),
  ]);
  return constantTimeEqual(a, b);
}
