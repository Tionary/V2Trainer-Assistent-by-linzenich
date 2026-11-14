/**
 * Prüft die Microsoft-Anmeldung (Entra ID) und den Passwort-Modus ohne echtes
 * Microsoft-Konto: Ein nachgebauter Token-Endpunkt signiert ID-Tokens mit einem
 * eigens erzeugten RSA-Schlüssel. Aufruf: npm run test:auth
 */
import assert from 'node:assert/strict';
const SRC = new URL('../src/', import.meta.url).href;
const worker = (await import(SRC + 'index.js')).default;
const { base64UrlEncode } = await import(SRC + 'crypto.js');

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OID = '99999999-8888-7777-6666-555555555555';
const ORIGIN = 'https://trainer.example.workers.dev';
const env = {
  ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, ENTRA_CLIENT_SECRET: 'S3cr3t-Wert~xyz',
  SESSION_SECRET: 'x'.repeat(48), ENTRA_ALLOWED_ROLES: 'Trainer,Admin', ENTRA_SESSION_TTL_HOURS: '168',
  ASSETS: { fetch: async (r) => new Response('<html>App</html>', { headers: { 'Content-Type': 'text/html' } }) },
};

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
const otherKeys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
const pubJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
const enc = (o) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
async function sign(claims, key = keys.privateKey, kid = 'k1') {
  const h = enc({ alg: 'RS256', kid, typ: 'JWT' }), p = enc(claims);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p)));
  return `${h}.${p}.${base64UrlEncode(sig)}`;
}

let tokenBehaviour; let lastTokenBody; let jwksCalls = 0;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url === `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`) { jwksCalls++; return Response.json({ keys: [{ ...pubJwk, kid: 'k1' }] }); }
  if (url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`) { lastTokenBody = new URLSearchParams(init.body.toString()); return tokenBehaviour(lastTokenBody); }
  throw new Error('Unerwarteter fetch: ' + url);
};

const call = (path, { method = 'GET', cookie, headers = {} } = {}) =>
  worker.fetch(new Request(ORIGIN + path, { method, redirect: 'manual', headers: { Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}), ...headers } }), env);
const cookiesOf = (res) => res.headers.getSetCookie();
const cookieVal = (res, name) => { const c = cookiesOf(res).find((x) => x.startsWith(name + '=')); return c ? c.split(';')[0] : null; };

const now = () => Math.floor(Date.now() / 1000);
const baseClaims = (nonce, extra = {}) => ({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, tid: TENANT, oid: OID, nonce, exp: now() + 3600, nbf: now() - 10, iat: now() - 10, name: 'Anna Trainer', preferred_username: 'anna@linzenich-gruppe.de', roles: ['Trainer'], ...extra });

async function startFlow(next = '/kraft-coach.html') {
  const r = await call('/auth/start?next=' + encodeURIComponent(next));
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(loc.searchParams.get('redirect_uri'), ORIGIN + '/auth/callback');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('prompt'), 'select_account');
  const flowCookie = cookieVal(r, 'ta_auth');
  assert.ok(cookiesOf(r)[0].includes('Path=/auth') && cookiesOf(r)[0].includes('HttpOnly'));
  return { state: loc.searchParams.get('state'), nonce: loc.searchParams.get('nonce'), challenge: loc.searchParams.get('code_challenge'), flowCookie };
}
const results = [];
const test = async (name, fn) => { try { await fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ': ' + e.message); process.exitCode = 1; } };

await test('Ohne Anmeldung → /login, Seite zeigt Microsoft-Knopf', async () => {
  let r = await call('/');
  assert.equal(r.status, 302); assert.equal(r.headers.get('Location'), '/login?next=%2F');
  r = await call('/login');
  const html = await r.text();
  assert.ok(html.includes('Mit Microsoft anmelden') && html.includes('/auth/start?next=%2F'));
  assert.ok(!html.includes('type="password"'));
  assert.ok(r.headers.get('Content-Security-Policy').includes("form-action 'self' https://login.microsoftonline.com"));
});

let sessionCookie;
await test('Erfolgreiche Anmeldung mit Rolle Trainer', async () => {
  const f = await startFlow();
  tokenBehaviour = async (body) => {
    // PKCE: Verifier muss zur Challenge passen
    const digest = base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))));
    assert.equal(digest, f.challenge);
    assert.equal(body.get('client_secret'), 'S3cr3t-Wert~xyz');
    return Response.json({ id_token: await sign(baseClaims(f.nonce)) });
  };
  const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  assert.equal(r.status, 302, await r.clone().text());
  assert.equal(r.headers.get('Location'), '/kraft-coach.html');
  sessionCookie = cookieVal(r, 'ta_session');
  assert.ok(sessionCookie && sessionCookie.length > 20);
  assert.ok(cookiesOf(r).some((c) => c.startsWith('ta_auth=;') && c.includes('Max-Age=0')));
  const app = await call('/kraft-coach.html', { cookie: sessionCookie });
  assert.equal(app.status, 200);
  const me = await (await call('/api/me', { cookie: sessionCookie })).json();
  assert.deepEqual(me, { modus: 'entra', name: 'Anna Trainer', benutzer: 'anna@linzenich-gruppe.de', rollen: ['Trainer'] });
});

await test('Ohne passende Rolle → 403, keine Sitzung', async () => {
  const f = await startFlow();
  tokenBehaviour = async () => Response.json({ id_token: await sign(baseClaims(f.nonce, { roles: [] })) });
  const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  assert.equal(r.status, 403); assert.equal(cookieVal(r, 'ta_session'), null);
  assert.ok((await r.text()).includes('keine Rolle'));
});

for (const [name, mutate, needle] of [
  ['Falscher Mandant', { tid: '00000000-0000-0000-0000-000000000000', iss: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0' }, 'nicht zur Linzenich'],
  ['Falsche App (aud)', { aud: '12345678-1234-1234-1234-123456789012' }, 'andere Anwendung'],
  ['Abgelaufenes Token', { exp: now() - 3600 }, 'zu lange'],
  ['Falscher Nonce', { nonce: 'gefaelscht' }, 'diesem Browser'],
]) {
  await test(name + ' → abgelehnt', async () => {
    const f = await startFlow();
    tokenBehaviour = async () => Response.json({ id_token: await sign({ ...baseClaims(f.nonce), ...mutate }) });
    const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
    assert.equal(r.status, 401); assert.equal(cookieVal(r, 'ta_session'), null);
    const t = await r.text(); assert.ok(t.includes(needle), t.slice(t.indexOf('class="error"'), t.indexOf('class="error"') + 300));
  });
}

await test('Fremde Signatur (anderer Schlüssel, gleiche kid) → abgelehnt', async () => {
  const f = await startFlow();
  tokenBehaviour = async () => Response.json({ id_token: await sign(baseClaims(f.nonce), otherKeys.privateKey) });
  const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  assert.equal(r.status, 401); assert.ok((await r.text()).includes('nicht korrekt signiert'));
});

await test('Unbekannte kid → JWKS neu laden, dann abgelehnt', async () => {
  const before = jwksCalls; const f = await startFlow();
  tokenBehaviour = async () => Response.json({ id_token: await sign(baseClaims(f.nonce), keys.privateKey, 'unbekannt') });
  const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  assert.equal(r.status, 401); assert.equal(jwksCalls, before + 1);
});

await test('alg=none wird abgelehnt', async () => {
  const f = await startFlow();
  tokenBehaviour = async () => Response.json({ id_token: enc({ alg: 'none', kid: 'k1' }) + '.' + enc(baseClaims(f.nonce)) + '.' });
  const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  assert.equal(r.status, 401);
});

await test('State passt nicht / Cookie fehlt → 400', async () => {
  const f = await startFlow();
  let r = await call(`/auth/callback?code=abc&state=falsch`, { cookie: f.flowCookie });
  assert.equal(r.status, 400);
  r = await call(`/auth/callback?code=abc&state=${f.state}`);
  assert.equal(r.status, 400);
});

await test('Microsoft-Fehler AADSTS50105 → verständliche Meldung', async () => {
  const r = await call('/auth/callback?error=access_denied&error_description=' + encodeURIComponent('AADSTS50105: The signed in user is not assigned to a role'));
  assert.equal(r.status, 403); assert.ok((await r.text()).includes('nicht freigeschaltet'));
});

await test('Falscher Client-Secret → Hinweis auf Wert statt ID', async () => {
  const f = await startFlow();
  tokenBehaviour = async () => Response.json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, { status: 401 });
  const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  assert.ok((await r.text()).includes('Geheimnis-ID'));
});

await test('Offener Redirect über next wird verhindert', async () => {
  const f = await startFlow('//boese.example/');
  tokenBehaviour = async () => Response.json({ id_token: await sign(baseClaims(f.nonce)) });
  const r = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  assert.equal(r.headers.get('Location'), '/');
});

await test('Gefälschtes Sitzungs-Cookie und Passwort-Token werden nicht akzeptiert', async () => {
  const [, val] = sessionCookie.split('=');
  const parts = val.split('.');
  const forged = enc({ id: OID, n: 'Mallory', u: 'x', r: ['Admin'], exp: now() + 999 });
  let r = await call('/', { cookie: `ta_session=u1.${forged}.${parts[2]}` });
  assert.equal(r.status, 302);
  r = await call('/', { cookie: `ta_session=${Date.now() + 99999}.abc.def` });
  assert.equal(r.status, 302);
});

await test('Rolle aus erlaubter Liste entfernt → Sitzung sofort ungültig', async () => {
  const r = await worker.fetch(new Request(ORIGIN + '/', { redirect: 'manual', headers: { Accept: 'text/html', Cookie: sessionCookie } }), { ...env, ENTRA_ALLOWED_ROLES: 'Admin' });
  assert.equal(r.status, 302);
});

await test('Abmelden → Cookie gelöscht, weiter zu Microsoft-Logout', async () => {
  const r = await call('/logout', { method: 'POST', cookie: sessionCookie, headers: { Origin: ORIGIN } });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('Location'));
  assert.equal(loc.pathname, `/${TENANT}/oauth2/v2.0/logout`);
  assert.equal(loc.searchParams.get('post_logout_redirect_uri'), ORIGIN + '/abgemeldet');
  assert.ok(cookiesOf(r)[0].includes('Max-Age=0'));
  const page = await call('/abgemeldet');
  assert.equal(page.status, 200); assert.ok((await page.text()).includes('Du bist abgemeldet'));
});

await test('QR-Links bleiben ohne Anmeldung erreichbar (abgelaufen → 410)', async () => {
  const r = await call('/s/kaputt.abc'); assert.equal(r.status, 410);
});

await test('Konfigfehler: nur Tenant-ID gesetzt → klare Meldung', async () => {
  const r = await worker.fetch(new Request(ORIGIN + '/'), { ...env, ENTRA_CLIENT_ID: '' });
  assert.equal(r.status, 503); assert.ok((await r.text()).includes('ENTRA_CLIENT_ID</code> fehlt'));
  const r2 = await worker.fetch(new Request(ORIGIN + '/'), { ...env, ENTRA_CLIENT_SECRET: undefined });
  assert.equal(r2.status, 503); assert.ok((await r2.text()).includes('ENTRA_CLIENT_SECRET'));
  const r3 = await worker.fetch(new Request(ORIGIN + '/'), { ...env, ENTRA_TENANT_ID: 'linzenich-gruppe.de' });
  assert.ok((await r3.text()).includes('nicht das Format'));
});

await test('/__status zeigt Umleitungs-URIs (angemeldet)', async () => {
  const f = await startFlow();
  tokenBehaviour = async () => Response.json({ id_token: await sign(baseClaims(f.nonce, { roles: ['Admin'] })) });
  const cb = await call(`/auth/callback?code=abc&state=${f.state}`, { cookie: f.flowCookie });
  const s = await (await call('/__status', { cookie: cookieVal(cb, 'ta_session') })).json();
  assert.deepEqual(s.microsoft.umleitungsUrisFuerEntra, [ORIGIN + '/auth/callback', ORIGIN + '/abgemeldet']);
  assert.equal(s.anmeldung, 'Microsoft Entra ID'); assert.equal(s.angemeldetAls.name, 'Anna Trainer');
  assert.ok(!JSON.stringify(s).includes('S3cr3t'));
});

await test('Passwort-Modus unverändert, wenn Entra-IDs leer', async () => {
  const penv = { APP_PASSWORD: 'Kettlebell-74', SESSION_SECRET: 'y'.repeat(48), ASSETS: env.ASSETS, ENTRA_TENANT_ID: '', ENTRA_CLIENT_ID: '' };
  let r = await worker.fetch(new Request(ORIGIN + '/login'), penv);
  assert.ok((await r.text()).includes('type="password"'));
  r = await worker.fetch(new Request(ORIGIN + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=Kettlebell-74&next=/' }), penv);
  assert.equal(r.status, 302);
  const c = r.headers.getSetCookie()[0].split(';')[0];
  r = await worker.fetch(new Request(ORIGIN + '/', { headers: { Cookie: c } }), penv);
  assert.equal(r.status, 200);
  r = await worker.fetch(new Request(ORIGIN + '/auth/start', { redirect: 'manual' }), penv);
  assert.equal(r.headers.get('Location'), '/login');
  r = await worker.fetch(new Request(ORIGIN + '/logout', { method: 'POST', redirect: 'manual', headers: { Origin: ORIGIN, Cookie: c } }), penv);
  assert.equal(r.headers.get('Location'), '/login');
});

console.log(results.join('\n'));
