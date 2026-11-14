# Anmeldung mit Microsoft einrichten (Entra ID)

Statt des gemeinsamen Team-Passworts meldet sich jede Person mit ihrem
Microsoft-Konto der Linzenich Gruppe an. Wer Zugang hat, legst Du in Microsoft
Entra fest – nicht im Trainer-Assistenten.

**Zeitbedarf:** etwa 30 Minuten.
**Wer:** jemand mit Admin-Zugang zu Microsoft Entra (mindestens die Rolle
*Anwendungsadministrator*, notfalls *Globaler Administrator*) und jemand mit
Zugang zum Cloudflare-Konto und zum GitHub-Repository.

> **Du bestimmst, wann es live geht.** Die Einstellung `ANMELDUNG` in der
> `wrangler.jsonc` hat drei Stufen:
>
> | Stufe | Anmeldeseite | Wann |
> |---|---|---|
> | `"passwort"` | nur Team-Passwort, kein Hinweis auf Microsoft | jetzt – während Du einrichtest und selbst testest |
> | `"beide"` | Team-Passwort, darunter klein „Oder mit Microsoft-Konto anmelden“ | nachdem das Team informiert ist (Übergangszeit) |
> | `"microsoft"` | nur noch „Mit Microsoft anmelden“ | fester Wechsel; das Team-Passwort gilt ab dann nicht mehr |
>
> Ausgeliefert ist `"passwort"`. Die Einrichtung in Entra kannst Du also in
> Ruhe erledigen und selbst ausprobieren, ohne dass jemand im Team etwas
> davon sieht.

---

## Inhalt

1. [Was am Ende dabei herauskommt](#1-was-am-ende-dabei-herauskommt)
2. [Vorher klären: Clubaccounts oder persönliche Konten?](#2-vorher-klären-clubaccounts-oder-persönliche-konten)
3. [Schritt für Schritt in Microsoft Entra](#3-schritt-für-schritt-in-microsoft-entra)
4. [Schritt für Schritt in Cloudflare und GitHub](#4-schritt-für-schritt-in-cloudflare-und-github)
5. [Selbst testen, dann ankündigen, dann umstellen](#5-selbst-testen-dann-ankündigen-dann-umstellen)
6. [Im Alltag](#6-im-alltag)
7. [Wenn etwas nicht klappt](#7-wenn-etwas-nicht-klappt)
8. [Technischer Hintergrund](#8-technischer-hintergrund)

---

## 1. Was am Ende dabei herauskommt

* Nach dem festen Wechsel zeigt die Anmeldeseite nur noch einen Knopf **„Mit
  Microsoft anmelden“** (in der Übergangszeit klein unter dem Passwortfeld).
* Wer darauf tippt, landet bei Microsoft, wählt sein Konto und kommt zurück.
  Ist die Person am Gerät schon bei Microsoft angemeldet (z. B. durch Outlook
  im selben Browser), reicht ein Tipp auf das Konto.
* Rein kommt nur, wem Du in Entra die Rolle **Trainer** oder **Admin** für
  den Trainer-Assistenten gegeben hast. Alle anderen sehen den Hinweis, dass
  ihr Konto nicht freigeschaltet ist.
* Auf der Startseite steht neben „Abmelden“, wer gerade angemeldet ist.
* **Abmelden** meldet auch bei Microsoft ab. Auf einem gemeinsam genutzten
  Studio-Tablet ist danach niemand mehr angemeldet.
* Eine Anmeldung gilt **7 Tage**, danach fragt die Seite erneut.
* Wer die Firma verlässt, verliert den Zugang, sobald Ihr das Konto in
  Entra deaktiviert oder die Zuweisung entfernt – spätestens nach Ablauf der
  7 Tage (Details in [6.3](#63-jemand-verlässt-das-team)).
* QR-Codes für Kunden funktionieren unverändert ohne Anmeldung.
* Wer mit dem Team-Passwort angemeldet ist, wird beim Abmelden **nicht** zu
  Microsoft weitergeleitet – das passiert nur bei Microsoft-Anmeldungen.

---

## 2. Vorher klären: Clubaccounts oder persönliche Konten?

Technisch funktioniert beides gleich. Der Unterschied liegt darin, was Ihr
später nachvollziehen könnt.

| | Clubaccount (ein Konto pro Studio) | Persönliches Konto (eins pro Trainer) |
|---|---|---|
| Einrichtung | wenige Konten freischalten | jede Person freischalten |
| Wer war das? | nur „Studio X“ | genau eine Person |
| Wenn jemand das Team verlässt | Passwort des Clubaccounts ändern, alle im Studio betroffen | nur dieses Konto sperren |
| Zwei-Faktor-Anmeldung (MFA) | schwierig, weil sich mehrere ein Handy teilen müssten | normal möglich |
| Geeignet für die geplante Kundenakte (Gesundheitsdaten) | **nein** – die DSGVO verlangt nachvollziehbare Zugriffe | ja |

**Empfehlung:** Für den Start sind Clubaccounts in Ordnung. Sobald
Kundendaten gespeichert werden (Kundenakte, Trainingsprotokoll), sollten die
Trainer persönliche Konten nutzen. Beides lässt sich parallel freischalten –
die Seite unterscheidet das nicht.

---

## 3. Schritt für Schritt in Microsoft Entra

Öffne **https://entra.microsoft.com** und melde Dich mit einem Admin-Konto
an. Die Beschriftungen stehen hier auf Deutsch, in Klammern die englische
Variante, falls Euer Portal auf Englisch eingestellt ist.

> **Wo im Menü?** Microsoft hat die Navigation mehrfach umgebaut. Je nach
> Stand heißt der Weg *Entra ID → App-Registrierungen* oder
> *Identität → Anwendungen → App-Registrierungen*. Notfalls oben in die
> Suchleiste „App-Registrierungen“ tippen.

### Schritt 1 – Die Adresse der Seite bereithalten

Du brauchst gleich die genaue Adresse, unter der der Trainer-Assistent läuft,
zum Beispiel:

```
https://trainer-assistent-by-linzenich.DEIN-NAME.workers.dev
```

Daraus ergeben sich zwei Rücksprungadressen, die Du in Schritt 2 und 4
einträgst:

```
https://trainer-assistent-by-linzenich.DEIN-NAME.workers.dev/auth/callback
https://trainer-assistent-by-linzenich.DEIN-NAME.workers.dev/abgemeldet
```

> Ohne Schrägstrich am Ende, mit `https://`, exakt so geschrieben. Ein
> einziges abweichendes Zeichen führt später zum Fehler **AADSTS50011**.
>
> Wechselt Ihr später auf eine eigene Adresse (z. B.
> `trainer.linzenich-gruppe.de`), müssen die beiden Adressen mit der neuen
> Domain **zusätzlich** eingetragen werden.

### Schritt 2 – App registrieren

1. **App-Registrierungen** (*App registrations*) → **Neue Registrierung**
   (*New registration*)
2. Ausfüllen:

   | Feld | Eintrag |
   |---|---|
   | Name | `Trainer-Assistent by linzenich` |
   | Unterstützte Kontotypen (*Supported account types*) | **Nur Konten in diesem Organisationsverzeichnis** (*Single tenant*) |
   | Umleitungs-URI (*Redirect URI*) | Plattform **Web**, Adresse: `https://…/auth/callback` aus Schritt 1 |

3. **Registrieren** (*Register*)

> **Wichtig:** Unbedingt *Single tenant* wählen. Bei „Konten in einem
> beliebigen Organisationsverzeichnis“ könnten sich Konten fremder Firmen
> zumindest bis zur Microsoft-Seite durchklicken. Der Trainer-Assistent weist
> sie zwar ab, aber die Einstellung gehört trotzdem auf den eigenen Mandanten.

### Schritt 3 – Die beiden IDs notieren

Du landest auf der **Übersicht** (*Overview*) der neuen App. Notiere:

| Bezeichnung in Entra | Wofür | Beispiel |
|---|---|---|
| **Anwendungs-ID (Client)** (*Application (client) ID*) | `ENTRA_CLIENT_ID` | `1a2b3c4d-…` |
| **Verzeichnis-ID (Mandant)** (*Directory (tenant) ID*) | `ENTRA_TENANT_ID` | `9f8e7d6c-…` |

Beide sind nicht geheim. Sie landen später in der `wrangler.jsonc`.

> Die **Objekt-ID** (*Object ID*) wird nicht gebraucht. Sie steht direkt
> darunter und wird leicht verwechselt.

### Schritt 4 – Zweite Rücksprungadresse und Einstellungen

1. Links **Authentifizierung** (*Authentication*)
2. Unter **Web → Umleitungs-URIs** auf **URI hinzufügen** und die zweite
   Adresse eintragen: `https://…/abgemeldet`
3. **Abmelde-URL für Front-Channel** (*Front-channel logout URL*): leer lassen
4. **Implizite Gewährung und Hybridflows** (*Implicit grant and hybrid
   flows*): **beide Haken aus** lassen (Zugriffstoken und ID-Token). Der
   Trainer-Assistent nutzt den sichereren Code-Flow.
5. **Speichern**

Es stehen jetzt genau zwei Web-Umleitungs-URIs da: `…/auth/callback` und
`…/abgemeldet`.

*Optional für lokale Tests:* Wer mit `npm run dev` am eigenen Rechner testet,
trägt zusätzlich `http://localhost:8787/auth/callback` und
`http://localhost:8787/abgemeldet` ein.

### Schritt 5 – Geheimen Schlüssel erzeugen

1. Links **Zertifikate & Geheimnisse** (*Certificates & secrets*)
2. Reiter **Geheime Clientschlüssel** (*Client secrets*) → **Neuer geheimer
   Clientschlüssel** (*New client secret*)
3. Beschreibung: `Cloudflare Worker`, Gültig bis: **24 Monate**
4. **Hinzufügen**
5. In der Tabelle erscheinen zwei Werte. **Kopiere die Spalte „Wert“**
   (*Value*) – sofort, sie wird nur jetzt angezeigt.

> ### ⚠️ „Wert“, nicht „Geheime ID“
>
> Die Spalte **Geheime ID** (*Secret ID*) sieht aus wie eine Microsoft-ID
> (`1a2b3c4d-…`) und wird ständig verwechselt. Der richtige **Wert** ist eine
> etwa 40 Zeichen lange Zeichenkette mit Tilde, z. B. `aB3~xY9…`. Wird die ID
> statt des Werts eingetragen, meldet die Seite später den Fehler
> **AADSTS7000215**.

> ### 📅 Erinnerung eintragen
>
> Der Schlüssel läuft nach 24 Monaten ab. Dann kann sich **niemand** mehr
> anmelden. Trage Dir jetzt einen Termin **zwei Wochen vor Ablauf** in den
> Kalender ein: „Trainer-Assistent: Microsoft-Schlüssel erneuern
> (ANLEITUNG-MICROSOFT-LOGIN.md, 6.4)“. Das Ablaufdatum steht in der Tabelle.

Bewahre den Wert bis Schritt 10 sicher auf (z. B. im Passwortmanager), nicht
in einer E-Mail oder einem Chat.

### Schritt 6 – Berechtigungen und Administratorzustimmung

1. Links **API-Berechtigungen** (*API permissions*)
2. Dort steht bereits **Microsoft Graph → User.Read**. Das genügt fast.
3. **Berechtigung hinzufügen** (*Add a permission*) → **Microsoft Graph** →
   **Delegierte Berechtigungen** (*Delegated permissions*) → unter
   *OpenId-Berechtigungen* **email**, **openid** und **profile** anhaken →
   **Berechtigungen hinzufügen**
4. **Administratorzustimmung für „Linzenich …“ erteilen** (*Grant admin
   consent for …*) → **Ja**

In der Spalte *Status* steht danach bei allen vier Einträgen ein grüner Haken
„Gewährt für …“. Ohne diese Zustimmung fragt Microsoft jede Person beim
ersten Anmelden um Erlaubnis – oder blockiert, wenn Mitarbeitende keine
Zustimmung geben dürfen (Fehler **AADSTS65001**).

### Schritt 7 – App-Rollen anlegen

Rollen legen fest, wer hinein darf. Später (Kundenakte) lässt sich damit auch
unterscheiden, wer was sehen darf.

1. Links **App-Rollen** (*App roles*) → **App-Rolle erstellen** (*Create app
   role*)
2. Erste Rolle:

   | Feld | Eintrag |
   |---|---|
   | Anzeigename (*Display name*) | `Trainer` |
   | Zulässige Mitgliedstypen (*Allowed member types*) | **Benutzer/Gruppen** (*Users/Groups*) |
   | Wert (*Value*) | `Trainer` |
   | Beschreibung | `Nutzt den Trainer-Assistenten im Personal Training` |
   | Diese App-Rolle aktivieren? | **Haken setzen** |

3. **Anwenden** (*Apply*)
4. Zweite Rolle genauso, nur mit Anzeigename und Wert **`Admin`** und der
   Beschreibung `Leitung Personal Training, verwaltet den Trainer-Assistenten`.

> Der **Wert** muss exakt `Trainer` bzw. `Admin` lauten – Groß-/Kleinschreibung
> zählt. Genau diese Wörter prüft der Trainer-Assistent
> (`ENTRA_ALLOWED_ROLES` in der `wrangler.jsonc`).

### Schritt 8 – Zugang auf freigeschaltete Konten beschränken

Bisher dürfte sich jedes Konto der Firma bis zum Trainer-Assistenten
durchklicken (er würde es wegen der fehlenden Rolle abweisen). Sauberer ist,
wenn Microsoft schon vorher blockt.

1. Im Menü **Unternehmensanwendungen** (*Enterprise applications*) öffnen –
   nicht *App-Registrierungen*
2. **Trainer-Assistent by linzenich** anklicken
3. Links **Eigenschaften** (*Properties*)
4. **Zuweisung erforderlich?** (*Assignment required?*) auf **Ja**
5. **Für Benutzer sichtbar?** (*Visible to users?*) auf **Ja** – dann
   erscheint der Trainer-Assistent im Microsoft-365-App-Starter und unter
   myapps.microsoft.com der Mitarbeitenden
6. **Speichern**

*Optional:* Unter **Eigenschaften → Logo** das App-Symbol
`public/icons/icon-512.png` hochladen, damit es im App-Starter erkennbar ist.

### Schritt 9 – Konten freischalten

Weiterhin in der **Unternehmensanwendung**:

1. Links **Benutzer und Gruppen** (*Users and groups*) → **Benutzer/Gruppe
   hinzufügen** (*Add user/group*)
2. **Benutzer und Gruppen** → die Clubaccounts bzw. Trainer auswählen →
   **Auswählen**
3. **Rolle auswählen** → **Trainer** (bzw. **Admin** für die PT-Leitung) →
   **Auswählen**
4. **Zuweisen** (*Assign*)

> **Gruppen statt Einzelpersonen:** Bequemer ist eine Gruppe, z. B.
> „Trainer-Assistent Nutzer“. Wer in die Gruppe kommt, hat Zugang. Gruppen
> lassen sich hier aber nur zuweisen, wenn Euer Microsoft-Abonnement
> **Entra ID P1** enthält (z. B. in *Microsoft 365 Business Premium* oder
> *E3/E5*). Ohne P1 ist das Feld für Gruppen ausgegraut; dann Personen
> einzeln zuweisen – das funktioniert in jedem Abonnement.

> **Zwei-Faktor-Anmeldung:** Mit Entra ID P1 lässt sich über
> *Bedingter Zugriff* (*Conditional Access*) für diese App MFA verlangen.
> Für persönliche Konten ist das empfehlenswert, sobald Kundendaten im Spiel
> sind.

---

## 4. Schritt für Schritt in Cloudflare und GitHub

### Schritt 10 – Den geheimen Schlüssel bei Cloudflare hinterlegen

1. Cloudflare-Dashboard → **Compute (Workers)** → Euer Worker
   `trainer-assistent-by-linzenich`
2. **Settings** → **Variables & Secrets** → **Add**
3. **Zuerst** den Typ auf **Secret** stellen, **dann** ausfüllen:

   | Type | Variable name | Value |
   |---|---|---|
   | Secret | `ENTRA_CLIENT_SECRET` | der **Wert** aus Schritt 5 |

4. **Deploy**

Es gelten dieselben Regeln wie beim Team-Passwort (ANLEITUNG.md, Schritt A5):
Typ *Secret*, nicht *Text*; Name exakt in Großbuchstaben mit Unterstrichen;
kein Leerzeichen am Ende des Werts.

### Schritt 11 – Die beiden IDs in die `wrangler.jsonc` eintragen

Auf github.com im Repository die Datei `wrangler.jsonc` öffnen → Stift-Symbol
(*Edit*). Unter `"vars"` die beiden leeren Felder füllen und **`ANMELDUNG`
auf `"passwort"` lassen**:

```jsonc
    "ANMELDUNG": "passwort",
    …
    "ENTRA_TENANT_ID": "9f8e7d6c-…",   // Verzeichnis-ID aus Schritt 3
    "ENTRA_CLIENT_ID": "1a2b3c4d-…",   // Anwendungs-ID aus Schritt 3
```

**Commit changes** auf `main`. Nach etwa einer Minute ist die Änderung live –
für das Team ändert sich **nichts**, die Anmeldeseite sieht aus wie immer.

---

## 5. Selbst testen, dann ankündigen, dann umstellen

### 5.1 Selbst testen (Stufe „passwort“, unsichtbar fürs Team)

Microsoft ist jetzt eingerichtet, aber auf der Anmeldeseite nicht zu sehen.
Zum Ausprobieren rufst Du die Startadresse der Microsoft-Anmeldung direkt auf:

```
https://…/auth/start
```

1. **Mit einem freigeschalteten Konto** in einem privaten Browserfenster
   `https://…/auth/start` öffnen → Konto wählen → Du landest auf der
   Startseite. Unten steht „Angemeldet als …“.
2. **Diagnose:** `https://…/__status` öffnen. Dort muss stehen:
   * `"anmeldung": "Team-Passwort (Microsoft unsichtbar)"`
   * `"microsoft": { "eingerichtet": true, "problem": null, … }`
   * `"angemeldetAls"` mit Deinem Namen und Deiner Rolle
   * unter `umleitungsUrisFuerEntra` genau die beiden Adressen, die in Entra
     eingetragen sind
3. **Mit einem nicht freigeschalteten Konto** (z. B. einer Kollegin aus der
   Verwaltung): Die Anmeldung endet mit „Dein Microsoft-Konto ist für den
   Trainer-Assistenten nicht freigeschaltet“.
4. **Abmelden:** unten auf der Startseite „Abmelden“ → Microsoft fragt ggf.,
   welches Konto abgemeldet werden soll → Seite „Du bist abgemeldet“.
5. **QR-Code:** einen bestehenden QR-Code mit dem Handy scannen – die PDF
   öffnet sich weiterhin ohne Anmeldung.
6. **Ein, zwei Trainer** als Testpersonen dieselbe Adresse ausprobieren
   lassen, am besten auch auf einem Studio-Tablet und einem iPhone mit der
   App auf dem Startbildschirm.

> Die Adresse `/auth/start` ist kein Geheimnis, aber auch ohne Wirkung für
> Unbefugte: Hinein kommt nur, wer in Entra freigeschaltet ist und eine Rolle
> hat.

### 5.2 Team informieren

Was die Mitarbeitenden wissen müssen – als Vorlage für die Info-Mail:

> **Neu im Trainer-Assistenten: Anmeldung mit Deinem Microsoft-Konto**
>
> Ab sofort kannst Du Dich im Trainer-Assistenten mit Deinem Microsoft-Konto
> der Linzenich Gruppe anmelden – also mit denselben Zugangsdaten wie für
> Outlook und Teams. Auf der Anmeldeseite findest Du dafür unter dem
> Passwortfeld den Link „Oder mit Microsoft-Konto anmelden“.
>
> Das Team-Passwort funktioniert noch bis zum **[Datum]**. Danach ist nur
> noch die Anmeldung mit Microsoft möglich.
>
> Auf gemeinsam genutzten Tablets bitte nach der Schicht unten auf der
> Startseite „Abmelden“ tippen – das meldet auch bei Microsoft ab.
>
> Wenn die Anmeldung meldet, dass Dein Konto nicht freigeschaltet ist, melde
> Dich bei **[Ansprechpartner]**.

### 5.3 Übergangszeit einschalten (Stufe „beide“)

In der `wrangler.jsonc` auf github.com:

```jsonc
    "ANMELDUNG": "beide",
```

**Commit changes** auf `main`. Nach etwa einer Minute steht unter dem
Passwortfeld klein „Oder mit Microsoft-Konto anmelden“. Wer schon mit dem
Passwort angemeldet ist, bleibt angemeldet.

In dieser Zeit lohnt ein Blick, wer schon umgestiegen ist: Wer sich mit
Microsoft anmeldet, sieht unten auf der Startseite „Angemeldet als …“. Bei
Passwort-Anmeldungen steht dort nichts.

### 5.4 Fest umstellen (Stufe „microsoft“)

Zum angekündigten Datum:

```jsonc
    "ANMELDUNG": "microsoft",
```

**Commit changes** auf `main`. Nach etwa einer Minute:

* Die Anmeldeseite zeigt nur noch den großen Knopf „Mit Microsoft anmelden“.
* Alle, die noch mit dem Team-Passwort angemeldet waren, sind **sofort
  abgemeldet** und müssen sich mit Microsoft anmelden.
* Das Team-Passwort funktioniert nicht mehr – auch nicht, wenn jemand es noch
  kennt.

Das Secret `APP_PASSWORD` in Cloudflare **nicht löschen**. Es wird in dieser
Stufe ignoriert, dient aber als Notfall-Zugang
([6.5](#65-notfall-zurück-zum-team-passwort)).

---

## 6. Im Alltag

### 6.1 Neue Person freischalten

Entra → **Unternehmensanwendungen** → *Trainer-Assistent by linzenich* →
**Benutzer und Gruppen** → **Benutzer/Gruppe hinzufügen** → Person und Rolle
wählen → **Zuweisen**. Wirkt sofort. (Mit Gruppen: Person einfach in die
Gruppe aufnehmen.)

### 6.2 Studio-Tablets und gemeinsam genutzte Geräte

* Beim Anmelden fragt Microsoft immer, welches Konto verwendet werden soll –
  auch wenn auf dem Gerät schon jemand angemeldet ist.
* Nach der Schicht **„Abmelden“** tippen. Das meldet auch bei Microsoft ab,
  also z. B. auch aus Outlook im selben Browser.
* Die als App auf dem Startbildschirm abgelegte Version (iPhone/iPad) hat
  einen eigenen Speicher. Dort muss man sich einmal separat anmelden.

### 6.3 Jemand verlässt das Team

1. In Entra das Konto deaktivieren **oder** die Zuweisung unter *Benutzer und
   Gruppen* entfernen. Ab sofort ist **keine neue Anmeldung** mehr möglich.
2. Eine bereits bestehende Anmeldung auf einem Gerät läuft noch bis zu
   7 Tage weiter (`ENTRA_SESSION_TTL_HOURS`).
3. Soll sie **sofort** enden: In Cloudflare das Secret `SESSION_SECRET` durch
   eine neue Zeichenkette ersetzen (ANLEITUNG.md, Schritt A4). Das meldet
   **alle** ab – und macht **alle bestehenden QR-Codes ungültig**, weil sie mit
   demselben Schlüssel signiert sind. Deshalb nur im Ernstfall.

Bei Clubaccounts: Passwort des Clubaccounts in Microsoft ändern **und** in
Entra unter *Benutzer → Konto → Sitzungen widerrufen* (*Revoke sessions*)
klicken. Für bereits bestehende Anmeldungen im Trainer-Assistenten gilt
Punkt 2 und 3.

### 6.4 Schlüssel erneuern (alle 24 Monate)

1. Entra → **App-Registrierungen** → *Trainer-Assistent by linzenich* →
   **Zertifikate & Geheimnisse** → **Neuer geheimer Clientschlüssel** →
   24 Monate → **Wert** kopieren
2. Cloudflare → Worker → **Settings → Variables & Secrets** → bei
   `ENTRA_CLIENT_SECRET` auf **Edit** → neuen Wert eintragen → **Deploy**
3. Einmal ab- und wieder anmelden, um zu prüfen
4. In Entra den **alten** Schlüssel löschen
5. Neuen Kalendertermin für den nächsten Wechsel eintragen

Weil der alte Schlüssel bis Schritt 4 gültig bleibt, gibt es keine
Unterbrechung.

### 6.5 Notfall: zurück zum Team-Passwort

Falls Microsoft gestört ist oder die Einrichtung klemmt: In der
`wrangler.jsonc` `ANMELDUNG` auf `"beide"` (Passwort wieder zusätzlich
erlaubt) oder `"passwort"` (Microsoft wieder unsichtbar) setzen und
speichern. Nach dem Deploy gilt wieder das Team-Passwort (`APP_PASSWORD`).
Die Einrichtung in Entra bleibt dabei unberührt.

### 6.6 Einstellungen in der `wrangler.jsonc`

| Variable | Bedeutung | Standard |
|---|---|---|
| `ANMELDUNG` | `"passwort"`, `"beide"` oder `"microsoft"` (siehe oben) | `"passwort"` |
| `ENTRA_TENANT_ID` | Verzeichnis-ID aus Entra | `""` |
| `ENTRA_CLIENT_ID` | Anwendungs-ID der App-Registrierung | `""` |
| `ENTRA_ALLOWED_ROLES` | Welche App-Rollen hinein dürfen, mit Komma getrennt. `*` = jedes Konto, das Entra durchlässt | `Trainer,Admin` |
| `ENTRA_SESSION_TTL_HOURS` | Wie lange eine Anmeldung gilt (Stunden) | `168` (7 Tage) |

Das Secret `ENTRA_CLIENT_SECRET` steht **nur** im Cloudflare-Dashboard.

---

## 7. Wenn etwas nicht klappt

Microsoft meldet Fehler mit einem Code der Form **AADSTS** und einer Zahl.
Die Seite übersetzt die häufigsten; hier die Ursachen:

| Meldung / Code | Ursache | Lösung |
|---|---|---|
| **AADSTS50011** – Umleitungs-URI passt nicht | Die Adresse in Entra weicht ab (http statt https, Schrägstrich am Ende, alte Domain) | `/__status` zeigt unter `umleitungsUrisFuerEntra` die exakt nötigen Adressen → in Entra (Schritt 4) genau so eintragen |
| **AADSTS50105** – „nicht freigeschaltet“ | Konto hat keine Zuweisung zur App | Schritt 9 für dieses Konto |
| „…hat aber keine Rolle für den Trainer-Assistenten“ | Zugewiesen, aber ohne Rolle (*Standardzugriff*) oder Rolle mit anderem Wert | Zuweisung löschen und mit Rolle **Trainer** neu anlegen; Wert der Rolle prüfen (Schritt 7) |
| **AADSTS700016** – Anwendung nicht gefunden | `ENTRA_CLIENT_ID` oder `ENTRA_TENANT_ID` falsch oder vertauscht | Schritt 3 und 11 vergleichen |
| **AADSTS7000215** – ungültiger geheimer Schlüssel | *Geheime ID* statt *Wert* eingetragen, oder Leerzeichen mitkopiert | Neuen Schlüssel erzeugen (Schritt 5), **Wert** eintragen (Schritt 10) |
| **AADSTS7000222** – Schlüssel abgelaufen | 24 Monate um | [6.4](#64-schlüssel-erneuern-alle-24-monate) |
| **AADSTS65001** – Zustimmung fehlt | Administratorzustimmung nicht erteilt | Schritt 6, Punkt 4 |
| „Dieses Konto gehört nicht zur Linzenich Gruppe“ | Privates Microsoft-Konto oder Konto einer anderen Firma gewählt | Mit dem Firmenkonto anmelden |
| „Die Anmeldung ist abgelaufen oder wurde in einem anderen Fenster gestartet“ | Mehr als 10 Minuten bei Microsoft verbracht, oder Anmeldung in zwei Tabs gleichzeitig | Einfach erneut auf „Mit Microsoft anmelden“ |
| „Einrichtung noch nicht abgeschlossen“ mit `ENTRA_…` im Text | Stufe `beide` oder `microsoft` gewählt, aber eine der IDs fehlt/ist falsch geschrieben oder `ENTRA_CLIENT_SECRET` fehlt | Die Seite nennt den betroffenen Eintrag; `/__status` zeigt Details. Sofort-Hilfe: `ANMELDUNG` zurück auf `"passwort"` |
| `/auth/start` führt zurück zur Anmeldeseite (Stufe `passwort`) | Microsoft-Einrichtung unvollständig | `/__status` → `microsoft.problem` nennt den fehlenden Eintrag |
| Nach Abmelden zeigt Microsoft eine Fehlerseite statt „Du bist abgemeldet“ | `…/abgemeldet` fehlt in den Umleitungs-URIs | Schritt 4, Punkt 2 |

Ein Blick in die Protokolle hilft ebenfalls: Cloudflare → Worker →
**Observability → Logs**. Abgelehnte Anmeldungen stehen dort mit Grund (bei
fehlender Rolle auch mit Benutzername), nie mit Schlüsseln oder Tokens.

---

## 8. Technischer Hintergrund

Für die IT oder einen späteren Entwickler:

* **Verfahren:** OpenID Connect, Authorization Code Flow mit PKCE (S256),
  vertraulicher Client mit geheimem Schlüssel. Endpunkte des eigenen
  Mandanten (`login.microsoftonline.com/<tenant>/oauth2/v2.0/…`), keine
  `common`-Endpunkte. `prompt=select_account`.
* **Prüfung des ID-Tokens:** RS256-Signatur gegen die öffentlichen Schlüssel
  des Mandanten (`/discovery/v2.0/keys`, im Worker zwischengespeichert, bei
  unbekannter Schlüssel-ID neu geladen), `iss`, `tid`, `aud`, `exp`/`nbf`
  (5 Minuten Toleranz), `nonce`, `oid`. Andere Algorithmen als RS256 werden
  abgelehnt.
* **Zwischenstand der Anmeldung** (state, nonce, PKCE-Verifier, Zielseite):
  HMAC-signiertes Cookie `ta_auth`, `HttpOnly; Secure; SameSite=Lax;
  Path=/auth`, 10 Minuten gültig, nach der Rückkehr gelöscht.
* **Sitzung:** HMAC-SHA256-signiertes Cookie `ta_session` mit Objekt-ID,
  Anzeigename, Benutzername, Rollen und Ablaufzeit. Signiert, nicht
  verschlüsselt – es liegt nur `HttpOnly` im Browser der angemeldeten Person.
  Die Rolle wird bei jeder Anfrage gegen `ENTRA_ALLOWED_ROLES` geprüft.
* **Abmeldung:** Cookie löschen, dann Weiterleitung zum Microsoft-Logout mit
  `post_logout_redirect_uri=…/abgemeldet`. Die Content-Security-Policy
  erlaubt dafür `form-action https://login.microsoftonline.com`.
* **Verbindungen zu Dritten:** Der Worker spricht ausschließlich mit
  `login.microsoftonline.com` (Token-Abruf und Signaturschlüssel). Die
  Modulseiten selbst bleiben ohne externe Verbindungen.
* **Datenschutz:** Microsoft verarbeitet die Anmeldung ohnehin im Rahmen
  Eures Microsoft-365-Vertrags. Neu gespeichert wird nichts – auch keine
  Anmeldeliste; Name und Benutzername stehen nur im Sitzungs-Cookie auf dem
  Gerät. Im Verzeichnis der Verarbeitungstätigkeiten sollte der
  Trainer-Assistent trotzdem mit „Anmeldung über Microsoft Entra ID“ ergänzt
  werden.
* **Stufen:** In `passwort` werden Microsoft-Sitzungen akzeptiert, sobald
  Entra vollständig eingerichtet ist (Probelauf), eine unvollständige
  Einrichtung legt die Seite aber nie lahm. In `microsoft` werden
  Passwort-Sitzungen bei der nächsten Anfrage verworfen und `APP_PASSWORD`
  wird nicht mehr benötigt.
* **Test:** `npm run test:auth` spielt den kompletten Ablauf mit einem
  nachgebauten Microsoft-Server durch (28 Prüfungen): erfolgreiche Anmeldung,
  fehlende Rolle, fremder Mandant, falsche App, abgelaufenes Token, falscher
  Nonce, fremde Signatur, unbekannte Schlüssel-ID, `alg: none`, manipulierter
  state, gefälschtes Sitzungs-Cookie, offener Redirect, Abmeldung,
  Konfigurationsfehler und alle drei Stufen einschließlich des Wechsels von
  `beide` auf `microsoft`.
