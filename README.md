# Trainer-Assistent by linzenich

Interne Trainer-Werkzeuge der Linzenich Gruppe – Ernährung, Kraft, Ausdauer und
Beweglichkeit – als passwortgeschützte Website auf Cloudflare Workers.

## 👉 Anleitung

**[ANLEITUNG.md](ANLEITUNG.md)** – Schritt für Schritt von Null bis zur
laufenden Seite, inklusive Datenschutz, Kosten und Problemlösung.

## Schnellstart

```bash
npm install
npx wrangler login
npx wrangler secret put APP_PASSWORD      # Team-Passwort
npx wrangler secret put SESSION_SECRET    # lange Zufallszeichenkette
npm run deploy
```

## Was drin ist

| Modul | Inhalt |
|---|---|
| Ernährung | Food Swapper, Kalorienrechner, Friendly-Food-Rezepte |
| Kraft | One-Rep-Max, Trainingsgewichte nach Ziel, Progressionsschemata |
| Ausdauer | Cardio-Coach (HF-Zonen, Planer) und PWC-Ausdauertest |
| Beweglichkeit | Functional Movement Screening mit Übungsableitung |
| Dokumente | PDFs mit befristeten QR-Codes für Teilnehmer |

## Aufbau

* `public/` – die App (wird veröffentlicht)
* `src/` – der Cloudflare Worker: Passwortschutz und QR-Freigaben
* `scripts/` – Helfer für PDF-Liste, Schriften und Icon-Prüfung
* `archiv/`, `quellen/` – Altbestand und Rohdaten, werden **nicht** veröffentlicht

## Wichtigste Befehle

```bash
npm run dev            # lokale Vorschau auf localhost:8787
npm run deploy         # veröffentlichen
npm run check          # Konfiguration prüfen
npm run check:icons    # prüfen, ob alle Icons in der Schrift enthalten sind
```

Details zu allem: [ANLEITUNG.md](ANLEITUNG.md)
