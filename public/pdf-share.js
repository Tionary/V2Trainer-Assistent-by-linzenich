/**
 * QR-Code für eine PDF, die das Modul gerade im Browser erzeugt hat.
 *
 * Warum der Umweg über den Server? In einen QR-Code passen rund 2 KB – eine
 * PDF wiegt das Tausendfache. Der Code kann also nur einen Link tragen. Die
 * fertige PDF wandert deshalb einmal zum Worker, liegt dort befristet und
 * bekommt einen Link, der ohne Anmeldung funktioniert. So kann der Kunde den
 * Code direkt am Gerät abscannen und seinen Plan aufs Handy holen.
 *
 * Einbinden (in dieser Reihenfolge):
 *   <script src="vendor/qrcode.js"></script>
 *   <script src="pdf-share.js"></script>
 *
 * Aufruf aus dem Modul:
 *   PdfShare.share({ blob: pdf.output('blob'), filename: 'Plan.pdf',
 *                    title: 'Trainingsplan' });
 *
 * Bewusst in ES5 gehalten – dieselbe Gangart wie dokumente.html, damit auch
 * ältere Tablets im Studio mitkommen.
 */
'use strict';
window.PdfShare = (function () {

  var STYLE_ID = 'ta-qr-style';
  var overlay = null;      // Dialog, wird beim ersten Aufruf gebaut
  var current = null;      // { blob, filename, title }
  var currentUrl = '';
  var els = {};

  /* ─────────────────────────── Aussehen ─────────────────────────── */

  var CSS = [
    '.ta-qr-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;',
    '  justify-content:center;padding:1.5rem;background:rgba(4,14,11,.8);backdrop-filter:blur(6px);',
    "  font-family:'Source Sans 3',ui-sans-serif,system-ui,sans-serif;color:#f2efe8}",
    '.ta-qr-overlay[data-open="true"]{display:flex}',
    '.ta-qr-modal{width:min(430px,100%);max-height:92vh;overflow-y:auto;border-radius:1.3rem;padding:1px;',
    '  background:linear-gradient(150deg,rgba(216,184,137,.55),rgba(92,184,92,.18) 38%,rgba(0,0,0,.35) 75%);',
    '  box-shadow:0 30px 60px -20px rgba(0,0,0,.85)}',
    '.ta-qr-inner{border-radius:calc(1.3rem - 1px);padding:1.75rem;',
    '  background:linear-gradient(158deg,#1c5645 0%,#154a3b 46%,#0f382d 100%)}',
    '.ta-qr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}',
    '.ta-qr-title{font-size:1.15rem;font-weight:800;line-height:1.3}',
    '.ta-qr-sub{font-size:.8rem;color:#9fb3aa;margin-top:.25rem;word-break:break-all}',
    '.ta-qr-close{font-family:inherit;font-size:1.6rem;color:#9fb3aa;background:transparent;border:0;',
    '  cursor:pointer;line-height:1;padding:.1rem .4rem;border-radius:.4rem}',
    '.ta-qr-close:hover{color:#f2efe8}',
    '.ta-qr-label{display:block;font-size:.7rem;font-weight:700;letter-spacing:.16em;',
    '  text-transform:uppercase;color:#9fb3aa;margin-bottom:.5rem}',
    '.ta-qr-select{width:100%;font-family:inherit;font-size:.95rem;color:#f2efe8;cursor:pointer;',
    '  padding:.7rem .9rem;border-radius:.7rem;background:rgba(0,0,0,.32);',
    '  border:1px solid rgba(216,184,137,.28)}',
    '.ta-qr-select:focus{outline:none;border-color:#d8b889}',
    '.ta-qr-stage{margin:1.4rem 0 1rem;display:flex;flex-direction:column;align-items:center;gap:.9rem}',
    '.ta-qr-box{background:#fff;padding:1rem;border-radius:.9rem;line-height:0;',
    '  box-shadow:0 12px 26px -14px rgba(0,0,0,.8)}',
    '.ta-qr-box svg{display:block;width:min(240px,60vw);height:auto}',
    '.ta-qr-note{font-size:.78rem;color:#9fb3aa;text-align:center;line-height:1.6}',
    '.ta-qr-url{width:100%;font-size:.74rem;color:#d8b889;word-break:break-all;line-height:1.55;',
    '  background:rgba(0,0,0,.3);padding:.65rem .8rem;border-radius:.6rem;',
    '  border:1px solid rgba(216,184,137,.2)}',
    '.ta-qr-actions{display:flex;gap:.6rem;margin-top:1.1rem;flex-wrap:wrap}',
    '.ta-qr-btn{flex:1 1 8rem;font-family:inherit;cursor:pointer;display:inline-flex;',
    '  align-items:center;justify-content:center;gap:.45rem;font-size:.76rem;font-weight:800;',
    '  letter-spacing:.05em;text-transform:uppercase;padding:.75rem .6rem;border-radius:.7rem;',
    '  border:0;white-space:nowrap}',
    '.ta-qr-btn--primary{color:#08221b;background:linear-gradient(160deg,#7fd27f,#5cb85c)}',
    '.ta-qr-btn--ghost{color:#d8b889;background:rgba(0,0,0,.22);',
    '  box-shadow:0 0 0 1px rgba(216,184,137,.32) inset}',
    '.ta-qr-btn:disabled{opacity:.5;cursor:default}',
    '.ta-qr-msg{margin-top:.9rem;font-size:.82rem;line-height:1.6;text-align:center}',
    '.ta-qr-msg--error{color:#e08a7a}',
    '.ta-qr-msg--ok{color:#7fd27f}',
    '.ta-qr-spin{display:inline-block;width:1.4rem;height:1.4rem;border-radius:50%;',
    '  border:2px solid rgba(216,184,137,.3);border-top-color:#d8b889;',
    '  animation:ta-qr-spin .7s linear infinite}',
    '@keyframes ta-qr-spin{to{transform:rotate(360deg)}}',
    '@media(prefers-reduced-motion:reduce){.ta-qr-spin{animation:none}}'
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ──────────────────────────── Dialog ──────────────────────────── */

  function build() {
    ensureStyle();
    overlay = document.createElement('div');
    overlay.className = 'ta-qr-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'QR-Code für die PDF');
    overlay.innerHTML =
      '<div class="ta-qr-modal"><div class="ta-qr-inner">' +
        '<div class="ta-qr-head">' +
          '<div><div class="ta-qr-title"></div><div class="ta-qr-sub"></div></div>' +
          '<button type="button" class="ta-qr-close" aria-label="Schließen">&times;</button>' +
        '</div>' +
        '<div>' +
          '<label class="ta-qr-label" for="ta-qr-ttl">Gültig für</label>' +
          '<select class="ta-qr-select" id="ta-qr-ttl">' +
            '<option value="24">24 Stunden</option>' +
            '<option value="72" selected>3 Tage</option>' +
            '<option value="168">7 Tage</option>' +
            '<option value="720">30 Tage</option>' +
          '</select>' +
        '</div>' +
        '<div class="ta-qr-stage"></div>' +
        '<div class="ta-qr-msg"></div>' +
        '<div class="ta-qr-actions">' +
          '<button type="button" class="ta-qr-btn ta-qr-btn--ghost" data-act="copy">Link kopieren</button>' +
          '<button type="button" class="ta-qr-btn ta-qr-btn--ghost" data-act="save">Herunterladen</button>' +
          '<button type="button" class="ta-qr-btn ta-qr-btn--primary" data-act="print">Drucken</button>' +
        '</div>' +
      '</div></div>';
    document.body.appendChild(overlay);

    els.title  = overlay.querySelector('.ta-qr-title');
    els.sub    = overlay.querySelector('.ta-qr-sub');
    els.ttl    = overlay.querySelector('#ta-qr-ttl');
    els.stage  = overlay.querySelector('.ta-qr-stage');
    els.msg    = overlay.querySelector('.ta-qr-msg');
    els.copy   = overlay.querySelector('[data-act="copy"]');
    els.save   = overlay.querySelector('[data-act="save"]');
    els.print  = overlay.querySelector('[data-act="print"]');

    els.ttl.addEventListener('change', upload);
    overlay.querySelector('.ta-qr-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.getAttribute('data-open') === 'true') close();
    });

    els.copy.addEventListener('click', copyLink);
    els.save.addEventListener('click', saveFile);
    els.print.addEventListener('click', printQr);
  }

  function close() {
    if (!overlay) return;
    overlay.setAttribute('data-open', 'false');
    document.body.style.overflow = '';
    els.stage.textContent = '';
    setMessage('');
    current = null;
    currentUrl = '';
  }

  function setMessage(text, kind) {
    els.msg.textContent = text || '';
    els.msg.className = 'ta-qr-msg' + (kind ? ' ta-qr-msg--' + kind : '');
  }

  function setBusy(busy) {
    els.copy.disabled = busy || !currentUrl;
    els.print.disabled = busy || !currentUrl;
  }

  /* ─────────────────────── Hochladen & QR ───────────────────────── */

  function upload() {
    if (!current) return;
    currentUrl = '';
    setMessage('');
    setBusy(true);
    els.stage.innerHTML = '<span class="ta-qr-spin" role="status" aria-label="QR-Code wird erstellt"></span>';

    var query = '?name=' + encodeURIComponent(current.filename) +
                '&ttlHours=' + encodeURIComponent(els.ttl.value);

    fetch('/api/share-file' + query, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/pdf' },
      body: current.blob
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status);
          return data;
        }, function () { throw new Error('Der Server hat unerwartet geantwortet (' + res.status + ').'); });
      })
      .then(function (data) {
        currentUrl = data.url;
        showQr(data.url, new Date(data.expiresAt));
        setBusy(false);
      })
      .catch(function (err) {
        els.stage.textContent = '';
        setBusy(false);
        setMessage(
          err.message === 'Nicht angemeldet'
            ? 'Deine Sitzung ist abgelaufen. Bitte lade die Seite neu und melde Dich an. ' +
              'Die PDF kannst Du unten trotzdem herunterladen.'
            : err.message,
          'error'
        );
      });
  }

  function qrSvg(url, label) {
    // Fehlerkorrektur "M" verkraftet rund 15 % Verschmutzung – gut für Ausdrucke.
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();

    var count = qr.getModuleCount();
    var parts = [];
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) parts.push('M' + col + ' ' + row + 'h1v1h-1z');
      }
    }
    var size = count + 4;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ' + size + ' ' + size +
      '" shape-rendering="crispEdges" role="img" aria-label="' + label + '">' +
      '<rect x="-2" y="-2" width="' + size + '" height="' + size + '" fill="#fff"/>' +
      '<path d="' + parts.join('') + '" fill="#000"/></svg>';
  }

  function formatDate(date) {
    return date.toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function showQr(url, expiresAt) {
    if (typeof qrcode !== 'function') {
      setMessage('Der QR-Baustein wurde nicht geladen (vendor/qrcode.js fehlt).', 'error');
      return;
    }
    els.stage.innerHTML =
      '<div class="ta-qr-box">' + qrSvg(url, 'QR-Code zur PDF') + '</div>' +
      '<div class="ta-qr-note">Mit der Handy-Kamera scannen.<br>Gültig bis ' +
        formatDate(expiresAt) + ' Uhr.</div>' +
      '<div class="ta-qr-url"></div>';
    els.stage.querySelector('.ta-qr-url').textContent = url;
  }

  /* ──────────────────────────── Aktionen ────────────────────────── */

  function copyLink() {
    if (!currentUrl) return;
    var done = function () { setMessage('Link kopiert.', 'ok'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(currentUrl).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var field = document.createElement('textarea');
      field.value = currentUrl;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { setMessage('Bitte den Link von Hand aus dem Feld kopieren.', 'error'); }
      document.body.removeChild(field);
    }
  }

  function saveFile() {
    if (!current) return;
    var url = URL.createObjectURL(current.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = current.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    setMessage('PDF gespeichert.', 'ok');
  }

  /**
   * Druckt nur den QR-Code – über einen eigenen Rahmen, damit die
   * Druckeinstellungen der jeweiligen Modulseite nicht dazwischenfunken.
   */
  function printQr() {
    if (!currentUrl || !current) return;
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);

    var doc = frame.contentDocument;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>QR-Code</title>' +
      '<style>body{margin:0;padding:14mm;font-family:ui-sans-serif,system-ui,sans-serif;' +
      'color:#000;text-align:center}h1{font-size:15pt;margin:0 0 2mm}' +
      'p{font-size:10pt;color:#444;margin:0 0 6mm}svg{width:70mm;height:70mm}' +
      '.u{font-size:7pt;color:#666;word-break:break-all;margin-top:6mm}</style></head><body>' +
      '<h1>' + escapeHtml(current.title) + '</h1>' +
      '<p>' + escapeHtml(current.filename) + '</p>' +
      qrSvg(currentUrl, 'QR-Code zur PDF') +
      '<div class="u">' + escapeHtml(currentUrl) + '</div>' +
      '</body></html>'
    );
    doc.close();

    // Kurz warten, bis der Rahmen fertig aufgebaut ist – sonst druckt
    // Safari eine leere Seite.
    setTimeout(function () {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(function () { document.body.removeChild(frame); }, 1000);
    }, 120);
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ──────────────────────────── Öffentlich ──────────────────────── */

  /**
   * @param {{blob: Blob, filename: string, title?: string}} options
   */
  function share(options) {
    if (!options || !options.blob) return;
    if (!overlay) build();

    current = {
      blob: options.blob,
      filename: options.filename || 'Bericht.pdf',
      title: options.title || 'QR-Code'
    };
    currentUrl = '';

    els.title.textContent = current.title;
    els.sub.textContent = current.filename;
    overlay.setAttribute('data-open', 'true');
    document.body.style.overflow = 'hidden';
    upload();
  }

  return { share: share, close: close };
})();
