/**
 * Mitglieder-PDFs im CI von by linzenich (Progressionsplan, Kalorienempfehlung).
 *
 * Die Seite wird als HTML in einem unsichtbaren iframe gesetzt und von dort
 * mit html2canvas abfotografiert. Der iframe hält die PDF frei von den Stilen
 * der Modulseite (Tailwind, dunkles App-Design) – im PDF gilt nur das CI:
 * weißer Grund, Gold #af8f61, Grün #144a3c, Source Sans.
 *
 * Einbinden (nach jsPDF, html2canvas, qrcode.js und pdf-share.js):
 *   <script src="member-pdf.js?v=…"></script>   (Version bei jeder Änderung hochzählen –
 *   der Worker lässt Skripte eine Stunde im Browser-Cache)
 *
 * Aufruf:
 *   MemberPdf.create({
 *     eyebrow: 'Dein Progressionsplan', headline: 'Beinpresse', sub: '…',
 *     body: MemberPdf.section('Titel', '<p class="p">…</p>'),
 *     legal: '*Fußnote', filename: 'Plan.pdf', title: 'Progressionsplan',
 *     mode: 'qr' | 'download',
 *     // optional: facts (Zeile im Kopf), stoerer {small, lines[]}, css (Zusatzstile)
 *   });
 */
'use strict';
window.MemberPdf = (function () {

  var PAGE_W = 794;   // A4 in CSS-Pixeln bei 96 dpi
  var PAGE_H = 1123;
  var FIT_LIMIT = 1.2; // bis 20 % Überlänge wird auf eine Seite verkleinert

  // Eigene Schriftfamilie fürs PDF. html2canvas misst den Text im iframe, malt
  // ihn aber auf eine Leinwand des Hauptdokuments – beide brauchen also exakt
  // dieselbe Schrift. Die Modulseiten definieren „Source Sans 3“ unterschiedlich
  // (die Ernährungsseite z. B. nur im Schnitt 200), daher ein eigener Name.
  var FONT = 'MemberPdf Sans';
  var WEIGHTS = ['400', '600', '700'];
  function fontUrl(w) { return '/fonts/source-sans-3-' + w + '-latin.woff2'; }

  var CSS = WEIGHTS.map(function (w) {
    return "@font-face{font-family:'" + FONT + "';font-weight:" + w + ";font-style:normal;src:url('" + fontUrl(w) + "') format('woff2')}";
  }).concat([
    '*{box-sizing:border-box}',
    "html,body{margin:0;padding:0;background:#fff}",
    ".pg{width:794px;min-height:1123px;display:flex;flex-direction:column;background:#fff;color:#1a1a1a;",
    "  font-family:'" + FONT + "','Source Sans Pro',system-ui,sans-serif}",
    '.top{display:flex;justify-content:space-between;align-items:center;padding:20px 48px 14px}',
    '.logo{height:52px;width:auto;display:block}',
    '.meta{text-align:right;font-size:13px;line-height:18px;color:#6b665e}',
    '.band{background:#af8f61;color:#1a1a1a;padding:10px 48px;font-size:16px;line-height:20px;font-weight:600;',
    '  letter-spacing:.02em;text-transform:uppercase}',
    '.hero{background:#144a3c;color:#fff;padding:20px 48px 22px;display:flex;align-items:center;gap:28px}',
    '.hero-main{flex:1;min-width:0}',
    '.hero h1{margin:0;font-size:46px;line-height:52px;font-weight:700;text-transform:uppercase}',
    '.hero p{margin:4px 0 0;font-size:17px;line-height:24px}',
    '.hero .facts{margin-top:8px;font-size:14px;line-height:20px;color:#e3ece8}',
    // Störer wie im Brandbook: goldener Kreis, leicht gedreht, Versalien
    '.stoerer{flex:none;width:128px;height:128px;border-radius:50%;background:#af8f61;display:flex;flex-direction:column;',
    '  align-items:center;justify-content:center;text-align:center;transform:rotate(-8deg)}',
    '.stoerer small{font-size:13px;line-height:16px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#1a1a1a}',
    '.stoerer b{font-size:20px;line-height:23px;font-weight:700;text-transform:uppercase;color:#fff}',
    '.sec{padding:16px 48px 0}',
    '.sec h2{margin:0 0 10px;font-size:22px;line-height:28px;font-weight:600}',
    '.p{margin:0;font-size:16px;line-height:24px}',
    '.p+.p{margin-top:8px}',
    '.mut{color:#6b665e}',
    '.cap{font-size:13px;line-height:18px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:#6b665e}',
    '.cap.gold{color:#7d6239}',
    '.g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}',
    '.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}',
    '.card{border:1px solid #d9d2c5;border-radius:12px;padding:13px 18px}',
    '.card.hl{background:#144a3c;border-color:#144a3c;color:#fff}',
    '.card.hl .cap{color:#fff}',
    '.num{font-size:28px;line-height:34px;font-weight:700;margin-top:2px}',
    '.num small{font-size:16px;font-weight:600;margin-left:4px}',
    '.txt{font-size:15px;line-height:21px;margin-top:2px}',
    '.warm{background:#f7f3ec;border-radius:12px;padding:14px 18px}',
    '.warm b{display:block;font-size:17px;line-height:22px;margin:2px 0 4px}',
    '.tbl{border:1px solid #d9d2c5;border-radius:12px;overflow:hidden}',
    '.tr{display:grid;grid-template-columns:96px 1fr 1fr 1.5fr;align-items:center;padding:11px 20px;',
    '  border-top:1px solid #d9d2c5;font-size:17px;line-height:24px}',
    '.tr.th{border-top:0;background:#f7f3ec;padding:9px 20px;font-size:13px;line-height:18px;font-weight:600;',
    '  letter-spacing:.02em;text-transform:uppercase;color:#6b665e}',
    '.tr .kg{font-size:20px;font-weight:700}',
    '.tips{margin:12px 0 0;padding-left:22px;font-size:16px;line-height:24px}',
    '.tips li+li{margin-top:4px}',
    // Kennzahlen in einer Leiste (z. B. Zeitraum)
    '.strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid #d9d2c5;border-radius:12px;overflow:hidden}',
    '.strip>div{padding:12px 18px}',
    '.strip>div+div{border-left:1px solid #d9d2c5}',
    '.foot{margin-top:auto;padding:18px 48px 20px;display:flex;justify-content:space-between;align-items:flex-end;gap:24px}',
    '.legal{font-size:13px;line-height:18px;color:#6b665e;max-width:520px}',
    '.claim{font-size:17px;font-weight:700;color:#7d6239;white-space:nowrap}'
  ]).join('\n');

  /* ─────────────────────────── Bausteine ─────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function section(title, inner) {
    return '<div class="sec">' + (title ? '<h2>' + esc(title) + '</h2>' : '') + inner + '</div>';
  }

  function pageHtml(o) {
    var date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return '<div class="pg">' +
      '<div class="top"><img class="logo" src="/by-linzenich-logo.png" alt="by linzenich – Mehr als Fitness!">' +
      '<div class="meta">Erstellt am ' + date + '</div></div>' +
      '<div class="band">' + esc(o.eyebrow) + '</div>' +
      '<div class="hero"><div class="hero-main"><h1>' + esc(o.headline) + '</h1>' +
      (o.sub ? '<p>' + esc(o.sub) + '</p>' : '') +
      (o.facts ? '<div class="facts">' + esc(o.facts) + '</div>' : '') + '</div>' +
      (o.stoerer ? '<div class="stoerer"><small>' + esc(o.stoerer.small) + '</small>' +
        o.stoerer.lines.map(function (l) { return '<b>' + esc(l) + '</b>'; }).join('') + '</div>' : '') +
      '</div>' +
      o.body +
      '<div class="foot"><div class="legal">' + esc(o.legal || '') + '</div>' +
      '<div class="claim">Mehr als Fitness!</div></div>' +
      '</div>';
  }

  /* ─────────────────────────── Rendern ─────────────────────────── */

  function frameFor(html, extraCss) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + PAGE_W + 'px;height:' + PAGE_H + 'px;border:0';
      f.onload = function () { resolve(f); };
      f.onerror = reject;
      f.srcdoc = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">' +
        '<base href="' + location.origin + '/">' +
        '<style>' + CSS + (extraCss || '') + '</style></head>' +
        '<body>' + html + '</body></html>';
      document.body.appendChild(f);
    });
  }

  function imagesReady(doc) {
    var imgs = Array.prototype.slice.call(doc.images);
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return null;
      return new Promise(function (res) { img.onload = img.onerror = res; });
    }));
  }

  function toPdf(canvas, scale, breaks) {
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF('p', 'mm', 'a4');
    var pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    var pageH = PAGE_H * scale;

    // Knapp zu lang: auf eine Seite verkleinern (zentriert), statt eine
    // Seite mit zwei Zeilen Rest anzuhängen.
    if (canvas.height <= pageH * FIT_LIMIT) {
      var fit = Math.min(1, pageH / canvas.height);
      var w = pw * fit, h = canvas.height * pw / canvas.width * fit;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pw - w) / 2, 0, w, h);
      return pdf;
    }

    // Länger: an Abschnittsgrenzen umbrechen, nie mitten durch einen Block.
    // Folgeseiten bekommen oben einen Rand.
    var TOP_MM = 12;
    var start = 0, first = true;
    while (start < canvas.height - 1) {
      var room = first ? pageH : pageH * (ph - TOP_MM) / ph;
      var end = start + room;
      if (end >= canvas.height) {
        end = canvas.height;
      } else {
        var fitting = breaks.filter(function (b) { return b > start + 40 && b <= end; });
        if (fitting.length) end = Math.max.apply(null, fitting);
      }
      end = Math.round(end);
      var tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = end - start;
      tmp.getContext('2d').drawImage(canvas, 0, start, canvas.width, end - start, 0, 0, canvas.width, end - start);
      if (!first) pdf.addPage();
      pdf.addImage(tmp.toDataURL('image/jpeg', 0.95), 'JPEG', 0, first ? 0 : TOP_MM, pw, (end - start) * pw / canvas.width);
      first = false;
      start = end;
    }
    return pdf;
  }

  /**
   * html2canvas misst die Grundlinie jeder Schrift mit einem 1×1-Bild in einem
   * versteckten div im HAUPTdokument. Seiten mit Tailwind setzen dort
   * img{display:block} – dann landet das Bild in einer eigenen Zeile, die
   * Messung wird zu groß und aller Text im PDF rutscht nach unten. Für die
   * Dauer des Renderns wird das zurückgesetzt.
   */
  function guardMetrics() {
    var st = document.createElement('style');
    st.textContent =
      'body>div[style*="visibility: hidden"]{line-height:normal!important}' +
      'body>div[style*="visibility: hidden"]>img{display:inline!important;max-width:none!important;height:1px!important}';
    document.head.appendChild(st);
    return function () { if (st.parentNode) st.parentNode.removeChild(st); };
  }

  /** Dieselbe Schrift im Hauptdokument registrieren (siehe FONT). */
  var hostFonts = null;
  function loadHostFonts() {
    if (!hostFonts) {
      hostFonts = (window.FontFace && document.fonts)
        ? Promise.all(WEIGHTS.map(function (w) {
            var face = new FontFace(FONT, 'url(' + fontUrl(w) + ") format('woff2')", { weight: w, style: 'normal' });
            document.fonts.add(face);
            return face.load();
          })).catch(function (e) { console.warn('PDF-Schrift nicht geladen', e); })
        : Promise.resolve();
    }
    return hostFonts;
  }

  /** Baut die PDF und speichert sie oder zeigt den QR-Code dazu. */
  function create(o) {
    if (!window.jspdf || !window.html2canvas) {
      alert('Die PDF-Funktion wird noch geladen. Bitte einen Moment warten und erneut versuchen.');
      return Promise.resolve(false);
    }
    var frame = null;
    return loadHostFonts()
      .then(function () { return frameFor(pageHtml(o), o.css); })
      .then(function (f) {
        frame = f;
        var doc = f.contentDocument;
        // Schriften ausdrücklich laden: fonts.ready allein greift zu früh, dann
        // misst html2canvas mit der Ersatzschrift (Wörter kleben aneinander).
        var fonts = doc.fonts
          ? Promise.all(WEIGHTS.map(function (w) {
              return doc.fonts.load(w + " 16px '" + FONT + "'", 'Aä');
            })).then(function () { return doc.fonts.ready; })
          : null;
        return Promise.all([fonts, imagesReady(doc)]).then(function () { return doc; });
      })
      .then(function (doc) {
        var root = doc.querySelector('.pg');
        frame.style.height = root.scrollHeight + 'px';
        var scale = 2;
        var breaks = [];
        var unguard = guardMetrics();
        return window.html2canvas(root, {
          scale: scale, backgroundColor: '#ffffff', useCORS: true, logging: false,
          windowWidth: PAGE_W, windowHeight: root.scrollHeight,
          // Umbruchstellen in der Kopie messen, die html2canvas tatsächlich malt
          onclone: function (cloned) {
            var pg = cloned.querySelector('.pg');
            var top = pg.getBoundingClientRect().top;
            // Mitte des oberen Abstands: html2canvas setzt Text ein paar Pixel
            // tiefer als das Layout, direkt an der Kante würde er angeschnitten.
            breaks = Array.prototype.map.call(pg.querySelectorAll('.sec,.coach,.foot'), function (el) {
              var gap = parseFloat(cloned.defaultView.getComputedStyle(el).paddingTop) || 0;
              if (el.classList.contains('coach')) gap = parseFloat(cloned.defaultView.getComputedStyle(el).marginTop) || 0;
              return (el.getBoundingClientRect().top - top + (el.classList.contains('coach') ? -gap / 2 : gap / 2)) * scale;
            });
          }
        }).then(function (canvas) { unguard(); return toPdf(canvas, scale, breaks); },
                function (err) { unguard(); throw err; });
      })
      .then(function (pdf) {
        if (o.mode === 'qr') {
          PdfShare.share({ blob: pdf.output('blob'), filename: o.filename, title: o.title });
        } else {
          pdf.save(o.filename);
        }
        return true;
      })
      .catch(function (err) {
        console.error(err);
        alert('Beim Erstellen des PDF ist ein Fehler aufgetreten. Bitte erneut versuchen.');
        return false;
      })
      .then(function (ok) {
        if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
        return ok;
      });
  }

  /** Dateinamen-tauglich: Umlaute bleiben, Sonderzeichen fliegen raus. */
  function safeName(s, fallback) {
    var clean = String(s || '').trim().replace(/[^\wäöüÄÖÜß -]/g, '').replace(/\s+/g, '_');
    return clean || fallback;
  }

  return { create: create, section: section, esc: esc, safeName: safeName };
})();
