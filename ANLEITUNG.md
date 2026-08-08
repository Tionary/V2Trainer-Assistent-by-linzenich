# Trainer-Assistent auf Cloudflare veröffentlichen

Diese Anleitung führt Dich von Null bis zur laufenden, passwortgeschützten
Website. Du brauchst dafür **keine Programmierkenntnisse** – aber Du wirst ein
paar Befehle in ein schwarzes Fenster (Terminal / Eingabeaufforderung) tippen.
Jeder Befehl steht hier zum Kopieren.

**Zeitbedarf beim ersten Mal: ca. 30–45 Minuten.**

---

## Inhalt

1. [Was am Ende dabei herauskommt](#1-was-am-ende-dabei-herauskommt)
2. [Vorbereitung](#2-vorbereitung)
3. [Schritt für Schritt zur Live-Seite](#3-schritt-für-schritt-zur-live-seite)
4. [Eigene Adresse statt workers.dev](#4-eigene-adresse-statt-workersdev-optional)
5. [Der Alltag: QR-Codes für PDFs](#5-der-alltag-qr-codes-für-pdfs)
6. [Pflege: PDFs, Passwort, Updates](#6-pflege-pdfs-passwort-updates)
7. [Was Du beachten musst](#7-was-du-beachten-musst)
8. [Datenschutz](#8-datenschutz)
9. [Kosten](#9-kosten)
10. [Wenn etwas nicht klappt](#10-wenn-etwas-nicht-klappt)
11. [Technischer Anhang](#11-technischer-anhang)

---

## 1. Was am Ende dabei herauskommt

Eine Adresse wie `https://trainer-assistent.dein-name.workers.dev` (oder Deine
eigene Domain), die Deine Mitarbeitenden auf Handy, Tablet und Rechner öffnen
können.

**Beim ersten Aufruf** erscheint eine Anmeldeseite im Look der App. Wer das
Team-Passwort eingibt, bleibt 30 Tage auf diesem Gerät angemeldet. Ohne
Passwort kommt niemand an die App – auch nicht, wenn er die genaue Adresse
einer einzelnen Datei kennt.

**Für Teilnehmer** gibt es eine Ausnahme, und die ist gewollt: Auf der Seite
„Dokumente & QR-Codes" erzeugst Du für jede PDF einen QR-Code. Wer den scannt,
bekommt genau diese eine PDF – ohne Passwort, und nur solange der Code gültig
ist (Du wählst 24 Stunden bis 30 Tage). Danach läuft er automatisch ab.

So sieht der Ablauf technisch aus:

```
                    ┌──────────────────────────────┐
  Mitarbeiter  ───▶ │  Cloudflare (weltweites Netz) │
  mit Passwort      │                               │
                    │   Türsteher (Worker)          │
                    │      ├─ Passwort korrekt? ────┼──▶  Die App
                    │      ├─ QR-Code gültig?  ─────┼──▶  Nur diese eine PDF
  Teilnehmer   ───▶ │      └─ sonst ────────────────┼──▶  Anmeldeseite
  mit QR-Code       └──────────────────────────────┘
```

---

## 2. Vorbereitung

### 2.1 Was Du brauchst

| Was | Wozu | Kosten |
|---|---|---|
| **Cloudflare-Konto** | Hosting | kostenlos |
| **Node.js** (Version 20 oder neuer) | um die Seite zu veröffentlichen | kostenlos |
| Dieser Projektordner | der Code | – |

### 2.2 Cloudflare-Konto anlegen

1. Auf [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) mit
   einer **Firmen-E-Mail-Adresse** registrieren (nicht mit einem privaten
   Konto – sonst hängt die Seite an einer Person).
2. E-Mail bestätigen.
3. **Zwei-Faktor-Authentifizierung einschalten**: oben rechts auf Dein Profil →
   *Authentication* → *Two-Factor Authentication*. Wer in dieses Konto kommt,
   kann die Seite verändern – das sollte gut geschützt sein.

### 2.3 Node.js installieren

Auf [nodejs.org](https://nodejs.org) die Version mit der Bezeichnung **„LTS"**
herunterladen und installieren (Standardeinstellungen durchklicken).

Danach prüfen, ob es geklappt hat. Terminal öffnen …

* **Windows:** Startmenü → „PowerShell" tippen → öffnen
* **Mac:** ⌘ + Leertaste → „Terminal" tippen → öffnen

… und eingeben:

```bash
node --version
```

Es muss eine Zahl wie `v22.14.0` erscheinen. Wenn dort `v20` oder höher steht,
bist Du startklar.

---

## 3. Schritt für Schritt zur Live-Seite

> **Wichtig:** Alle Befehle werden **im Projektordner** ausgeführt. Wechsle
> zuerst dorthin, zum Beispiel so:
>
> ```bash
> cd /Pfad/zu/V2Trainer-Assistent-by-linzenich
> ```
>
> Tipp: Du kannst `cd ` tippen (mit Leerzeichen) und dann den Ordner aus dem
> Explorer/Finder ins Terminal ziehen – der Pfad wird automatisch eingefügt.

### Schritt 1 – Bausteine installieren

```bash
npm install
```

Das lädt die Hilfsprogramme herunter (dauert ein bis zwei Minuten). Muss nur
einmal gemacht werden.

### Schritt 2 – Bei Cloudflare anmelden

```bash
npx wrangler login
```

Es öffnet sich der Browser. Dort auf **„Allow"** klicken. Danach zeigt das
Terminal `Successfully logged in`.

### Schritt 3 – Passwort und Sicherheitsschlüssel festlegen

Zwei Geheimnisse müssen gesetzt werden. Sie werden verschlüsselt bei Cloudflare
gespeichert und stehen **nirgends im Code**.

**a) Das Team-Passwort** – das, was die Mitarbeitenden eingeben:

```bash
npx wrangler secret put APP_PASSWORD
```

Das Terminal fragt nach dem Wert. Tippe das gewünschte Passwort ein und drücke
Enter. (Die Eingabe ist unsichtbar – das ist normal.)

> **Empfehlung:** Nimm drei bis vier zufällige Wörter mit Zahl, zum Beispiel
> `Kettlebell-Ahorn-Ruhepuls-74`. Das ist leicht weiterzugeben und trotzdem
> praktisch nicht zu erraten. Bitte **nicht** `linzenich2026` o. Ä. – das wird
> von Angreifern als Erstes probiert.

**b) Der Signaturschlüssel** – damit werden Anmeldungen und QR-Links
fälschungssicher gemacht. Diesen Wert kennt niemand, er muss nur zufällig sein.

Zuerst einen erzeugen:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

Das Ergebnis (eine lange Zeichenkette) kopieren. Dann:

```bash
npx wrangler secret put SESSION_SECRET
```

… und die kopierte Zeichenkette einfügen + Enter.

> ⚠️ Diesen Wert später **nicht ohne Grund ändern**. Ein neuer Schlüssel meldet
> alle Mitarbeitenden ab **und macht alle bereits verteilten QR-Codes ungültig**.

### Schritt 4 – Veröffentlichen

```bash
npm run deploy
```

Am Ende steht im Terminal eine Adresse, etwa:

```
https://trainer-assistent.dein-name.workers.dev
```

**Das ist Deine Seite.** Adresse kopieren und im Browser öffnen.

### Schritt 5 – Prüfen, ob alles sitzt

Bitte diese fünf Punkte einmal wirklich durchgehen:

- [ ] Die Adresse öffnen → es erscheint die **Anmeldeseite** (nicht die App).
- [ ] Mit dem Passwort anmelden → die Startseite mit den vier Kategorien
      erscheint.
- [ ] Ein Modul öffnen, z. B. **Kraft** → rechnet und zeigt Icons korrekt an.
- [ ] **Dokumente & QR-Codes** öffnen → auf *QR-Code* klicken → ein QR-Code
      erscheint.
- [ ] Diesen QR-Code **mit dem Handy scannen, ohne im Handy angemeldet zu
      sein** (am besten im privaten Fenster oder mit mobilen Daten statt WLAN)
      → die PDF öffnet sich.

Wenn alle fünf Haken sitzen, ist die Seite fertig und Du kannst die Adresse und
das Passwort an das Team geben.

---

## 4. Eigene Adresse statt workers.dev (optional)

`trainer-assistent.dein-name.workers.dev` funktioniert einwandfrei, sieht aber
technisch aus. Schöner wäre `trainer.linzenich-gruppe.de`.

**Voraussetzung:** Die Domain `linzenich-gruppe.de` muss bei Cloudflare
verwaltet werden. Das bedeutet, die Nameserver der Domain werden auf Cloudflare
umgestellt.

> ⚠️ **Achtung:** Diese Umstellung betrifft die **gesamte** Domain – auch die
> bestehende Website und **die E-Mail-Adressen**. Wenn dabei ein Eintrag
> vergessen wird, kommen keine E-Mails mehr an. Bitte **nur zusammen mit der
> IT bzw. der Agentur machen, die Eure Domain betreut.**

Ist die Domain bei Cloudflare, geht der Rest schnell:

1. Cloudflare-Dashboard → **Compute (Workers)** → `trainer-assistent`
2. **Settings** → **Domains & Routes** → **Add** → *Custom Domain*
3. `trainer.linzenich-gruppe.de` eintragen → speichern

Das Zertifikat (HTTPS) richtet Cloudflare automatisch ein; nach wenigen Minuten
ist die Adresse erreichbar.

> **Kein Risiko-Zwang:** Wenn Euch die Nameserver-Umstellung zu heikel ist,
> bleibt einfach bei der workers.dev-Adresse. Funktional ist sie identisch,
> inklusive HTTPS.

---

## 5. Der Alltag: QR-Codes für PDFs

So gibst Du einem Teilnehmer eine PDF:

1. Auf der Startseite unten **Dokumente & QR-Codes** öffnen.
2. Beim gewünschten Dokument auf **QR-Code** klicken.
3. **Gültigkeitsdauer** wählen:

   | Dauer | Wofür |
   |---|---|
   | 24 Stunden | Direkt im Termin scannen lassen |
   | 3 Tage *(Vorauswahl)* | Der Teilnehmer will es abends in Ruhe ansehen |
   | 7 Tage | Kursreihe, Aushang für eine Woche |
   | 30 Tage | Dauerhafter Aushang im Studio |

4. Jetzt hast Du drei Möglichkeiten:
   * **Scannen lassen** – Handy des Teilnehmers vor den Bildschirm halten.
   * **Drucken** – erzeugt ein sauberes Blatt mit großem QR-Code, Titel und
     Ablaufdatum (alles andere wird beim Drucken ausgeblendet). Ideal für den
     Aushang am Schwarzen Brett.
   * **Link kopieren** – zum Einfügen in WhatsApp, E-Mail oder Newsletter.

**Wichtig zu verstehen:** Der Link ist absichtlich ohne Passwort nutzbar – nur
so kann ein Teilnehmer ihn öffnen. Wer den Link weitergibt, gibt damit die PDF
weiter. Er funktioniert aber **nur für dieses eine Dokument** (nicht für die
App) und **nur bis zum Ablaufdatum**.

Deshalb: Für ein öffentliches Plakat lieber 7 Tage wählen und den Aushang
erneuern, statt einmalig 30 Tage zu vergeben.

---

## 6. Pflege: PDFs, Passwort, Updates

### 6.1 Eine neue PDF bereitstellen

1. Die Datei in den Ordner `public/dokumente/` legen.
2. Optional einen schönen Anzeigenamen vergeben – dazu
   `public/dokumente/titel.json` öffnen und ergänzen:

   ```json
   {
     "FriendlyFood-ebook.pdf": "Friendly Food – das E-Book",
     "Rueckenschule.pdf": "Rückenschule – die 10 Basisübungen"
   }
   ```

   (Ohne Eintrag wird der Dateiname als Titel verwendet.)
3. Veröffentlichen:

   ```bash
   npm run deploy
   ```

Die PDF taucht danach automatisch auf der Seite „Dokumente & QR-Codes" auf.
Mehr ist nicht zu tun.

> **Dateinamen:** Bitte ohne Umlaute und Leerzeichen, z. B.
> `Rueckenschule-Basis.pdf`. Erlaubt sind Buchstaben, Zahlen, `-`, `_`, `.`,
> `+`, `(`, `)`.

### 6.2 Die Einkaufsliste „unter 150 kcal" mit aufnehmen

Diese PDF liegt aktuell noch auf `bylinzenich.de` und wird von dort verlinkt.
Wenn Du sie ebenfalls per QR-Code verteilen möchtest:

1. Die Datei als `public/dokumente/Einkaufsliste-150kcal.pdf` speichern.
2. In `public/ernaehrungstools.html` diese eine Zeile suchen:

   ```html
   <a href="https://bylinzenich.de/assets/img/Dokumente/Einkaufsliste-150kcal.pdf" target="_blank"
   ```

   … und den Link ersetzen durch:

   ```html
   <a href="dokumente/Einkaufsliste-150kcal.pdf" target="_blank"
   ```
3. `npm run deploy`

### 6.3 Passwort ändern

```bash
npx wrangler secret put APP_PASSWORD
```

Neues Passwort eingeben – **fertig, kein `npm run deploy` nötig.** Die Änderung
greift innerhalb weniger Sekunden.

Dabei passiert Folgendes:

* Alle Mitarbeitenden werden auf allen Geräten **automatisch abgemeldet** und
  müssen sich mit dem neuen Passwort neu anmelden.
* Bereits verteilte **QR-Codes bleiben gültig**. Das ist Absicht: Ein
  Passwortwechsel im Team soll keine ausgedruckten Aushänge zerstören.

**Wann Du das Passwort wechseln solltest:**

* wenn eine Mitarbeiterin oder ein Mitarbeiter das Unternehmen verlässt,
* wenn das Passwort versehentlich nach außen gelangt ist,
* ansonsten routinemäßig etwa einmal im Jahr.

### 6.4 Änderungen an der App veröffentlichen

Immer derselbe Befehl:

```bash
npm run deploy
```

### 6.5 Vorher lokal ausprobieren (empfohlen bei Änderungen)

Einmalig die Datei `.dev.vars.example` kopieren und in `.dev.vars` umbenennen,
dann:

```bash
npm run dev
```

Die Seite läuft nun unter `http://localhost:8787` auf Deinem eigenen Rechner –
sichtbar nur für Dich. Beenden mit `Strg + C`.

---

## 7. Was Du beachten musst

Das Wichtigste ehrlich zusammengefasst – auch das, was der Schutz **nicht**
leistet.

### 7.1 Ein gemeinsames Passwort hat Grenzen

Alle nutzen dasselbe Passwort. Das ist einfach in der Handhabung, bedeutet aber:

* **Man sieht nicht, wer angemeldet war.** Es gibt keine Nutzerliste und keine
  personenbezogene Protokollierung.
* **Einzelne Personen kann man nicht sperren.** Scheidet jemand aus, muss das
  Passwort für alle gewechselt werden (Abschnitt 6.3).
* **Weitergabe lässt sich technisch nicht verhindern.** Bitte im Team klar
  ansagen: Das Passwort ist wie ein Schlüssel zum Studio.

**Wenn Ihr das genauer braucht** – z. B. jede Person meldet sich mit ihrer
eigenen Firmen-E-Mail an, Zugang beim Austritt einzeln entziehbar,
Anmeldeprotokoll – dann ist **Cloudflare Access** (im Zero-Trust-Bereich des
Dashboards) der richtige Weg. Für kleine Teams ist das in der Regel ebenfalls
kostenlos. Die App muss dafür nicht umgebaut werden; sag Bescheid, dann ergänze
ich die Anleitung.

### 7.2 QR-Links sind bewusst offen

Ein QR-Link funktioniert ohne Anmeldung, sonst wäre er für Teilnehmer nutzlos.
Er ist aber eng begrenzt: **eine Datei, begrenzte Zeit, kein Zugang zur App.**

Wähle die Gültigkeit deshalb so kurz wie praktikabel. Und lege in
`public/dokumente/` **nur PDFs ab, die für Teilnehmer gedacht sind** – keine
internen Unterlagen, Preislisten oder Personaldokumente.

### 7.3 Das Cloudflare-Konto ist der Generalschlüssel

Wer in das Cloudflare-Konto kommt, kann alles ändern. Deshalb: 2FA aktivieren
(Abschnitt 2.2) und den Zugang auf wenige Personen beschränken. Am besten
kennen mindestens zwei Personen im Haus die Zugangsdaten – sonst steht Ihr
still, wenn eine davon im Urlaub ist.

### 7.4 Das Passwort gehört nicht ins Repository

Die Geheimnisse liegen ausschließlich bei Cloudflare. Die Datei `.dev.vars`
(nur für lokale Tests) ist über `.gitignore` ausgeschlossen. Bitte niemals ein
Passwort in eine Datei schreiben, die eingecheckt wird.

### 7.5 Vorsicht bei geteilten Rechnern

Die Anmeldung hält 30 Tage. Auf einem Rechner, den mehrere nutzen (Studio-Tresen,
Empfang), bitte nach der Arbeit über **„Abmelden"** unten auf der Startseite
ausloggen.

### 7.6 Die Module rechnen, sie speichern nicht

Eingaben wie Name, Gewicht oder FMS-Punkte verlassen das Gerät nicht (siehe
Abschnitt 8). Das heißt aber auch: **Es gibt keine zentrale Historie.** Wird das
Gerät gewechselt oder der Browser-Speicher geleert, sind die Eingaben weg.
Erzeugte Auswertungen bitte als PDF speichern.

---

## 8. Datenschutz

### 8.1 Was gespeichert wird – und wo

| Daten | Wo | Verlässt das Gerät? |
|---|---|---|
| Teilnehmerdaten in den Modulen (Name, Gewicht, Puls, FMS-Werte …) | nur im Browser des Geräts | **Nein** |
| Erzeugte PDF-Auswertungen | werden im Browser gebaut, landen im Download-Ordner | **Nein** |
| Merkliste im Food Swapper, Ansichts-Einstellungen | Browser-Speicher des Geräts | **Nein** |
| Anmelde-Cookie | Browser des Geräts | enthält nur ein signiertes Ablaufdatum, **keinen Namen, kein Passwort** |
| Technische Zugriffsprotokolle (IP-Adresse, Zeitpunkt) | Cloudflare | ja – wie bei jedem Webhosting |

**Der Kernpunkt:** Die Rechner-Module laufen vollständig im Browser. Es gibt
keine Datenbank, in der Teilnehmerdaten liegen könnten – auch nicht bei
Cloudflare. Der Server liefert nur die Dateien aus.

### 8.2 Keine Verbindungen zu Dritten

Die App war ursprünglich mit Google Fonts und einem amerikanischen Skript-CDN
verbunden – bei jedem Seitenaufruf wurde also die IP-Adresse des Nutzers an
Google übertragen. Das ist in Deutschland ein bekannter Abmahngrund.

**Das ist bereinigt.** Alle Schriften und Programmbibliotheken liegen jetzt auf
Eurem eigenen Server. Beim Öffnen der Seite wird **keine einzige Verbindung zu
einem fremden Anbieter** aufgebaut. (Automatisch geprüft: 0 externe Aufrufe.)

Es gibt außerdem **kein Tracking, keine Analytics und keine Cookies außer dem
technisch notwendigen Anmelde-Cookie** – für das nach überwiegender Auffassung
keine Cookie-Einwilligung erforderlich ist.

### 8.3 Was Ihr trotzdem noch erledigen solltet

Das ist kein Rechtsrat, sondern eine Merkliste für Euren Datenschutzbeauftragten:

1. **Auftragsverarbeitungsvertrag (AVV) mit Cloudflare.** Cloudflare
   verarbeitet als Hoster technische Daten (u. a. IP-Adressen). Cloudflare
   stellt dafür einen DPA bereit, abrufbar im Dashboard unter
   *Manage Account → Configurations → Data Protection*.
2. **Verzeichnis von Verarbeitungstätigkeiten** um die interne Anwendung
   ergänzen.
3. **Impressum / Datenschutzhinweis:** Für eine rein interne Anwendung hinter
   Passwort in der Regel nicht erforderlich – bitte prüfen lassen, wenn Ihr
   QR-Links breit an Teilnehmer streut.
4. **Datenspeicherort:** Cloudflare betreibt ein weltweites Netz; die
   Auslieferung erfolgt vom nächstgelegenen Standort. Wenn eine Verarbeitung
   ausschließlich in der EU verlangt wird, gibt es dafür kostenpflichtige
   Optionen (*Data Localization Suite*). Für reine Dateiauslieferung ohne
   Personendaten ist das üblicherweise nicht nötig.

---

## 9. Kosten

Für eine Anwendung dieser Größe: **0 €.**

Der kostenlose Cloudflare-Tarif umfasst (Stand heute):

* **100.000 Anfragen pro Tag**
* unbegrenzten Speicher für die statischen Dateien (bis 20.000 Dateien –
  dieses Projekt hat rund 60)
* HTTPS-Zertifikat inklusive
* das Rate-Limiting gegen Passwort-Raten inklusive

Zur Einordnung: Ein vollständiger Seitenaufruf mit allen Bildern und Schriften
zählt grob 10–30 Anfragen. Selbst bei 30 Mitarbeitenden, die die App täglich
intensiv nutzen, bleibt Ihr weit unter dem Limit.

> **Hinweis:** Reine Dateiauslieferung ist bei Cloudflare kostenlos. Weil hier
> aber **jede** Anfrage vom Türsteher geprüft werden muss (sonst gäbe es keinen
> Passwortschutz), zählt jede Anfrage in das Kontingent. Das ändert an der
> Rechnung oben nichts – ist aber der Grund, warum die Zahl überhaupt relevant
> ist.

Kosten entstehen erst, wenn Ihr eine eigene Domain über Cloudflare **kauft**
(ca. 10 €/Jahr) oder kostenpflichtige Zusatzdienste bucht. Beides ist optional.

---

## 10. Wenn etwas nicht klappt

| Symptom | Ursache & Lösung |
|---|---|
| **„Einrichtung noch nicht abgeschlossen"** im Browser | Ein Geheimnis fehlt. Schritt 3 wiederholen: `npx wrangler secret put APP_PASSWORD` bzw. `SESSION_SECRET`. |
| **„Das Passwort stimmt nicht"**, obwohl es stimmt | Beim Setzen ist ein Leerzeichen mitgerutscht. Einfach neu setzen: `npx wrangler secret put APP_PASSWORD`. |
| **„Zu viele Versuche. Bitte warte eine Minute"** | Schutz gegen Passwort-Raten (8 Versuche pro Minute). Eine Minute warten. Kein Fehler. |
| **„Dieser Link ist abgelaufen"** beim Scannen | Der QR-Code ist älter als die gewählte Gültigkeit. Neuen Code erzeugen. |
| **`command not found: npm`** | Node.js ist nicht installiert oder das Terminal wurde vor der Installation geöffnet. Terminal schließen, neu öffnen; sonst Abschnitt 2.3. |
| **`wrangler login` öffnet keinen Browser** | Die im Terminal angezeigte Adresse von Hand in den Browser kopieren. |
| **Nach `npm run deploy` sieht man die alte Version** | Browser-Cache. Seite mit `Strg + F5` (Mac: `Cmd + Shift + R`) neu laden. |
| **Statt eines Symbols steht ein Wort wie `download` in der App** | Ein Icon fehlt in der Schrift. `npm run check:icons` ausführen – die Ausgabe sagt genau, was zu tun ist. |
| **PDF taucht nicht in der Liste auf** | Liegt sie wirklich in `public/dokumente/` und endet auf `.pdf`? Danach `npm run deploy` erneut ausführen. |

**Alles zurück auf Anfang:** Der Befehl `npm run deploy` kann beliebig oft
wiederholt werden. Er ersetzt jedes Mal die komplette Seite – kaputtmachen
kannst Du damit nichts.

---

## 11. Technischer Anhang

### 11.1 Aufbau des Projekts

```
public/              ← alles hier wird veröffentlicht
  index.html            Startseite mit den Kategorien
  ernaehrungstools.html Food Swapper, Kalorienrechner
  kraft-coach.html      One-Rep-Max, Trainingsgewichte
  pulsrechner.html      Cardio-Coach, HF-Zonen
  pwc.html              PWC-Ausdauertest
  fms.html              Functional Movement Screening
  dokumente.html        Dokumente & QR-Codes   ← neu
  dokumente/            die PDFs + manifest.json (automatisch) + titel.json
  fonts/                selbst gehostete Schriften  ← neu (DSGVO)
  vendor/               jsPDF, html2canvas, QR-Bibliothek  ← neu (DSGVO)
  fms-img/              Bilder für das FMS-Modul

src/                 ← der Türsteher (läuft bei Cloudflare)
  index.js              Routen, Zugriffsprüfung, Sicherheits-Header
  crypto.js             Signaturen, Passwortvergleich
  tokens.js             Sitzungs- und QR-Freigabe-Tokens
  login-page.js         die Anmeldeseite

scripts/             ← Helfer, laufen auf Deinem Rechner
  build-manifest.mjs    erstellt die PDF-Liste
  fetch-fonts.mjs       lädt die Schriften von Google herunter
  check-icons.mjs       prüft, ob alle Icons vorhanden sind
  icons.mjs             Liste der verwendeten Icons

archiv/              ← alte Einzeldatei-Version, wird NICHT veröffentlicht
quellen/             ← Logo-Rohdateien, werden NICHT veröffentlicht
wrangler.jsonc       ← Einstellungen (Laufzeiten, Rate-Limit)
```

### 11.2 Alle Befehle

| Befehl | Wirkung |
|---|---|
| `npm install` | Hilfsprogramme installieren (einmalig) |
| `npm run dev` | lokale Vorschau auf `localhost:8787` |
| `npm run deploy` | veröffentlichen |
| `npm run check` | Konfiguration prüfen, ohne zu veröffentlichen |
| `npm run check:icons` | prüfen, ob alle Icons in der Schrift sind |
| `npm run fetch:fonts` | Schriften neu von Google laden |
| `npx wrangler secret put APP_PASSWORD` | Team-Passwort setzen/ändern |
| `npx wrangler secret list` | anzeigen, welche Geheimnisse gesetzt sind |
| `npx wrangler tail` | Live-Protokoll der Zugriffe ansehen |

### 11.3 Einstellungen in `wrangler.jsonc`

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `SESSION_TTL_HOURS` | `720` (30 Tage) | wie lange eine Anmeldung hält |
| `SHARE_DEFAULT_TTL_HOURS` | `72` (3 Tage) | Vorauswahl im QR-Dialog |
| `SHARE_MAX_TTL_HOURS` | `720` (30 Tage) | Obergrenze, die wählbar ist |
| `ratelimits` → `limit` | `8` | erlaubte Anmeldeversuche pro Minute und IP |

Nach Änderungen: `npm run deploy`.

### 11.4 Wie der Schutz technisch funktioniert

* **Kein Vorbeikommen:** In `wrangler.jsonc` steht `"run_worker_first": true`.
  Damit wird **jede** Anfrage zuerst vom Worker geprüft – auch die nach
  einzelnen Bildern oder PDFs. Es gibt keinen Pfad, der die Prüfung umgeht.
* **Anmeldung:** Das Passwort wird zeitkonstant verglichen (kein Rückschluss
  über Antwortzeiten). Bei Erfolg bekommt der Browser ein Cookie mit einem
  HMAC-SHA256-signierten Ablaufdatum – `HttpOnly`, `Secure`, `SameSite=Lax`.
  Im Cookie steht kein Passwort und kein Name.
* **Passwortwechsel wirkt sofort:** In der Signatur steckt ein Fingerabdruck
  des aktuellen Passworts. Ändert es sich, passt keine alte Signatur mehr.
* **QR-Links:** eigener, getrennt signierter Token, der genau einen Pfad
  unterhalb von `/dokumente/` und ein Ablaufdatum enthält. Ein Sitzungs-Token
  kann nie als Freigabe-Token gelten und umgekehrt (getrennte Präfixe).
* **Nur PDFs freigebbar:** Der Pfad wird gegen ein striktes Muster geprüft
  (`/dokumente/<name>.pdf`, keine Unterordner, kein `..`, keine
  Prozent-Kodierung) und die Datei muss existieren.
* **CSRF-Schutz:** Bei jedem POST wird der `Origin`-Header geprüft.
* **Kein offener Redirect:** Das Ziel nach der Anmeldung muss ein
  seiteninterner Pfad sein.
* **Sicherheits-Header** auf jeder Antwort: Content-Security-Policy, HSTS,
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, `X-Robots-Tag: noindex`.
* **Caching:** Geschützte Inhalte werden ausschließlich als `private`
  ausgeliefert und landen nie in einem gemeinsam genutzten Zwischenspeicher.
* **Suchmaschinen:** `robots.txt` verbietet die Indexierung vollständig.

**Eine bewusste Einschränkung:** Die Content-Security-Policy erlaubt
`'unsafe-inline'` für Skripte. Grund: Die Module bringen ihren gesamten
JavaScript-Code direkt in der HTML-Datei mit. Das strenger zu machen, würde
bedeuten, alle sechs Module umzubauen. Da die Seite hinter einem Passwort liegt
und keine fremden Inhalte einbindet, ist das Risiko hier gering – erwähnt sei es
trotzdem.

### 11.5 Was getestet wurde

Vor der Übergabe automatisiert geprüft (lokal, mit echtem Browser):

* Ohne Anmeldung führen Startseite, alle sechs Module und der direkte
  PDF-Aufruf zur Anmeldeseite bzw. zu „401 Nicht angemeldet".
* Falsches Passwort wird abgewiesen, richtiges meldet an.
* Alle sechs Modulseiten laden fehlerfrei (0 Konsolenfehler, 0 fehlende
  Dateien).
* **0 Verbindungen zu externen Hosts.**
* Manipulierte, erfundene und abgelaufene QR-Token werden abgelehnt.
* Versuche, per Freigabe-Schnittstelle andere Dateien zu erreichen
  (`../index.html`, Nicht-PDFs, nicht existierende Dateien), scheitern.
* CSRF-Versuch von fremder Herkunft → abgewiesen; Weiterleitung auf eine
  fremde Domain → abgewiesen; überhöhte Gültigkeitsdauer → auf 30 Tage gekürzt.
* Passwortwechsel meldet bestehende Sitzungen ab, lässt QR-Codes aber gültig.
* Der erzeugte QR-Code wurde als Bild wieder **maschinell eingelesen** und
  enthielt exakt den richtigen Link – er ist also mit der Handykamera scanbar.
* Darstellung auf Desktop und iPhone geprüft.

---

## Kurzfassung zum Ausdrucken

```
Einmalig einrichten
   npm install
   npx wrangler login
   npx wrangler secret put APP_PASSWORD     ← Team-Passwort
   npx wrangler secret put SESSION_SECRET   ← lange Zufallszeichenkette
   npm run deploy

Neue PDF bereitstellen
   Datei nach public/dokumente/ legen
   npm run deploy

Passwort ändern (meldet alle ab, QR-Codes bleiben gültig)
   npx wrangler secret put APP_PASSWORD

QR-Code für einen Teilnehmer
   Startseite → Dokumente & QR-Codes → QR-Code → Dauer wählen
   → scannen lassen, drucken oder Link kopieren
```
