/**
 * Anmeldeseite. Wird direkt vom Worker gerendert, damit sie auch dann
 * existiert, wenn noch keine Sitzung besteht – die eigentlichen HTML-Dateien
 * unter public/ sind ja gesperrt.
 */

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

/**
 * @param {object} options
 * @param {string} options.next    Ziel nach erfolgreicher Anmeldung
 * @param {string} [options.error] Fehlermeldung über dem Formular
 */
export function renderLoginPage({ next = '/', error = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex, nofollow"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>Anmeldung · Trainer-Assistent by linzenich</title>
<link href="/fonts/fonts.css" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --gold:#af8f61; --gold-lt:#d8b889;
  --green:#5cb85c; --green-lt:#7fd27f;
  --txt:#f2efe8; --mut:#9fb3aa; --danger:#ff8f8f;
  --font:'Source Sans 3',ui-sans-serif,system-ui,sans-serif;
  --ms:'Material Symbols Outlined';
}
html,body{min-height:100vh;font-family:var(--font);color:var(--txt);overflow-x:hidden}
body{
  display:flex;align-items:center;justify-content:center;padding:2rem 1.25rem;
  background:
    radial-gradient(ellipse 80% 55% at 50% 18%, rgba(92,184,92,.16), transparent 60%),
    radial-gradient(ellipse 60% 50% at 50% 0%, rgba(175,143,97,.10), transparent 55%),
    radial-gradient(ellipse 120% 90% at 50% 40%, #14463a 0%, #0c3025 38%, #081e18 70%, #050f0c 100%);
  background-attachment:fixed;
}
body::before{
  content:'';position:fixed;width:520px;height:520px;top:-160px;left:-140px;border-radius:50%;
  background:radial-gradient(circle,rgba(92,184,92,.20),transparent 70%);filter:blur(90px);
  z-index:0;pointer-events:none;
}
.shell{position:relative;z-index:1;width:min(430px,100%);display:flex;flex-direction:column;align-items:center}
.logo{width:min(340px,84%);height:auto;display:block;margin-bottom:2rem;border-radius:1rem;
  box-shadow:0 24px 52px -20px rgba(0,0,0,.7),0 0 0 1px rgba(216,184,137,.25);user-select:none}
.panel{
  width:100%;border-radius:1.4rem;padding:1px;
  background:linear-gradient(150deg,rgba(216,184,137,.55),rgba(92,184,92,.18) 38%,rgba(0,0,0,.35) 75%);
  box-shadow:0 22px 40px -18px rgba(0,0,0,.7);
}
.panel__inner{
  border-radius:calc(1.4rem - 1px);padding:2rem 1.75rem 1.75rem;
  background:linear-gradient(158deg,#1c5645 0%,#154a3b 44%,#0f382d 78%,#0c2d24 100%);
}
h1{font-size:1.35rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.3rem}
.sub{font-size:.86rem;font-weight:300;color:var(--mut);line-height:1.6;margin-bottom:1.5rem}
label{display:block;font-size:.72rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:var(--mut);margin-bottom:.5rem}
.field{position:relative;display:flex;align-items:center}
input[type=password]{
  width:100%;font-family:inherit;font-size:1rem;color:var(--txt);
  padding:.85rem 3rem .85rem 1rem;border-radius:.8rem;
  background:rgba(0,0,0,.28);border:1px solid rgba(216,184,137,.28);
  transition:border-color .25s, box-shadow .25s;
}
input[type=password]:focus{outline:none;border-color:var(--gold-lt);
  box-shadow:0 0 0 3px rgba(175,143,97,.18)}
.toggle{
  position:absolute;right:.35rem;display:flex;align-items:center;justify-content:center;
  width:2.4rem;height:2.4rem;border:0;border-radius:.6rem;background:transparent;
  color:var(--mut);cursor:pointer;font-family:var(--ms);font-size:1.25rem;
}
.toggle:hover{color:var(--gold-lt)}
button[type=submit]{
  width:100%;margin-top:1.25rem;font-family:inherit;font-size:.82rem;font-weight:800;
  letter-spacing:.14em;text-transform:uppercase;color:#08221b;cursor:pointer;
  padding:.95rem 1rem;border:0;border-radius:.8rem;
  background:linear-gradient(160deg,var(--green-lt),var(--green));
  box-shadow:0 12px 24px -12px rgba(92,184,92,.8);
  transition:transform .2s, box-shadow .2s, filter .2s;
}
button[type=submit]:hover{transform:translateY(-2px);filter:brightness(1.06)}
button[type=submit]:active{transform:translateY(0)}
.error{
  display:flex;align-items:flex-start;gap:.55rem;margin-bottom:1.1rem;padding:.75rem .9rem;
  border-radius:.7rem;font-size:.84rem;line-height:1.5;color:var(--danger);
  background:rgba(255,143,143,.10);border:1px solid rgba(255,143,143,.35);
}
.error .ms{font-family:var(--ms);font-size:1.1rem;flex-shrink:0;margin-top:.05rem}
.hint{margin-top:1.35rem;padding-top:1.1rem;border-top:1px solid rgba(255,255,255,.08);
  font-size:.76rem;color:rgba(159,179,170,.75);line-height:1.6}
.foot{margin-top:1.75rem;font-size:.72rem;color:rgba(159,179,170,.5);letter-spacing:.06em;text-align:center}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<main class="shell">
  <img class="logo" src="/trainer-assistent-logo.png" alt="Trainer-Assistent by linzenich" draggable="false"/>

  <div class="panel">
    <div class="panel__inner">
      <h1>Interner Zugang</h1>
      <p class="sub">Der Trainer-Assistent steht ausschließlich Mitarbeitenden der
        Linzenich Gruppe zur Verfügung. Bitte gib das Team-Passwort ein.</p>

      ${error ? `<div class="error"><span class="ms">warning</span><span>${escapeHtml(error)}</span></div>` : ''}

      <form method="POST" action="/login" autocomplete="on">
        <input type="hidden" name="next" value="${escapeHtml(next)}"/>
        <label for="password">Team-Passwort</label>
        <div class="field">
          <input id="password" name="password" type="password" required autofocus
                 autocomplete="current-password" spellcheck="false"/>
          <button type="button" class="toggle" id="toggle"
                  aria-label="Passwort anzeigen">visibility</button>
        </div>
        <button type="submit">Anmelden</button>
      </form>

      <p class="hint">Du bleibst auf diesem Gerät angemeldet, bis du dich abmeldest.
        Auf gemeinsam genutzten Rechnern bitte nach der Arbeit abmelden.</p>
    </div>
  </div>

  <p class="foot">&copy; 2026 Linzenich Gruppe · Nur für interne Nutzung</p>
</main>

<script>
'use strict';
(function () {
  var toggle = document.getElementById('toggle');
  var input = document.getElementById('password');
  toggle.addEventListener('click', function () {
    var shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    toggle.textContent = shown ? 'visibility' : 'visibility_off';
    toggle.setAttribute('aria-label', shown ? 'Passwort anzeigen' : 'Passwort verbergen');
    input.focus();
  });
})();
</script>
</body>
</html>`;
}
