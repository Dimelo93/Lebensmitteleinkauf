# Einkaufsliste nach Läden

Eine Einkaufsliste, die nach Läden getrennt ist: Lidl, Migros, Coop, Halal Metzger, Asia Shop. Läuft als Web-App auf dem iPhone-Homescreen, funktioniert im Laden ohne Empfang, und lässt sich mit dem Partner teilen.

Dazu eine Quittungs-Analyse: Foto vom Kassenzettel machen, die App liest die Positionen aus, vergleicht sie mit den Preisen, die dieser Haushalt bisher bezahlt hat, und rechnet einen Sparplan.

## Was drin ist

**Liste**
Nach Laden gruppiert, in der Reihenfolge, in der du einkaufst. Innerhalb eines Ladens optional nach Abteilung (Gemüse, Kühlregal, Trockenware) — automatisch erkannt, in den Einstellungen abschaltbar. Antippen hakt ab, abgehakte Artikel rutschen durchgestrichen ans Ende.

**Artikel-Gedächtnis**
Beim ersten Mal wählst du den Laden. Ab dann schlägt die App ihn selbst vor: tippst du „Hummus", steht schon „→ Halal Metzger" darunter. Korrigierst du den Laden, merkt sich die App die Korrektur.

**Schnelleingabe**
`2 kg Rüebli` wird zu Menge 2, Einheit kg, Artikel Rüebli. `Milch, Brot, 500g Hackfleisch` legt drei Artikel auf einmal an. Auch `Poulet 1.5 kg` oder `Reis @ 4.50` funktionieren.

**Läden**
Anlegen, umbenennen, einfärben, verschieben. Die Reihenfolge ist deine Einkaufsroute. Tippst du eine Ladenüberschrift an, markierst du „hier bin ich gerade" und der Laden wandert nach oben.

**Vorlagen**
Artikel, die du jede Woche brauchst. Häkchen setzen, übernehmen, fertig. Was schon offen auf der Liste steht, wird nicht doppelt angelegt.

**Budget**
Preise pro Artikel, Summe pro Laden, Monatsübersicht, optionales Monatsbudget. Beim Abschliessen eines Einkaufs kannst du fehlende Preise nachtragen — die wandern ins Preisgedächtnis und machen die Quittungs-Analyse genauer.

**Quittungs-Analyse**
Foto vom Kassenzettel. Die Analyse liefert: alle Positionen mit Einzelpreisen, die auffälligsten Posten, konkrete günstigere Alternativen und einen Sparplan zum eingestellten Ziel (standardmässig 30 %). Vorschläge, die auf deinen eigenen bezahlten Preisen beruhen, sind als **belegt** markiert; der Rest als Schätzung. Wenn 30 % nicht erreichbar sind, sagt die Analyse das und nennt die Zahl, die erreichbar ist.

**Offline und geteilt**
Alles läuft zuerst lokal auf dem Gerät. Änderungen ohne Empfang landen in einer Warteschlange und gehen hoch, sobald wieder Netz da ist. Mit einem Haushalts-Code teilst du die Liste: einer hakt im Lidl ab, der andere sieht es sofort.

## Loslegen

### 1. Lokal ausprobieren

```bash
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Ohne weitere Einrichtung läuft alles ausser Teilen und Quittungs-Analyse.

### 2. Ins Netz stellen

Für den Homescreen braucht es HTTPS. Am einfachsten GitHub Pages:

1. Im GitHub-Repo unter **Settings → Pages**
2. Source: **Deploy from a branch**, Branch: `main`, Ordner `/ (root)`
3. Nach ein paar Minuten liegt die App unter `https://<benutzername>.github.io/<repo>/`

Vercel, Netlify oder jeder Webspace tun es genauso — es sind statische Dateien ohne Build-Schritt.

### 3. Aufs iPhone legen

Adresse in **Safari** öffnen (nicht Chrome), Teilen-Knopf → **Zum Home-Bildschirm**. Danach startet sie ohne Browserleiste und funktioniert offline.

### 4. Teilen und Quittungs-Analyse einrichten

Beides braucht Supabase. Die Schritt-für-Schritt-Anleitung steht in **[SUPABASE.md](SUPABASE.md)** — Konto anlegen, ein SQL-Skript einfügen, zwei Werte in die App kopieren. Rechnet mit 15 Minuten.

## Aufbau

```
index.html                    Hülle
config.js                     Supabase-Zugangsdaten (oder leer, dann in der App eintragen)
manifest.webmanifest, sw.js   PWA: Homescreen-Symbol und Offline-Cache
css/app.css                   Oberfläche, hell und dunkel
js/
  app.js                      Start, Tabs, Messung der Leistenhöhen
  state.js                    Zentraler Zustand, Gedächtnis, Preishistorie
  sync.js                     Abgleich mit Supabase, Outbox, Realtime
  katalog.js                  Abteilungen und Artikelwissen (inkl. Schweizer Begriffe)
  parse.js                    Schnelleingabe „2 kg Rüebli"
  analyse.js                  Bildkomprimierung, Aufruf der Analyse
  util.js                     Helfer
  ui/                         Ansichten: Liste, Läden, Vorlagen, Budget, Mehr
supabase/
  schema.sql                  Datenbank, Rechte, Realtime
  functions/analyse-quittung/ Edge Function für die Quittungs-Analyse
icons/                        App-Symbole
```

Keine Abhängigkeiten, kein Build-Schritt, kein `npm install`. Nur die Supabase-Bibliothek wird beim ersten Start vom CDN geladen und danach im Cache gehalten — ohne eingerichtete Verbindung wird sie gar nicht erst geholt.

## Grenzen, die du kennen solltest

- **Ohne Supabase kein Teilen.** Eine reine Web-App kann Daten nicht zwischen Geräten abgleichen.
- **Die Quittungs-Analyse kostet Geld.** Jede Auswertung ist ein Aufruf der Anthropic-API, grob 5 bis 20 Rappen pro Quittung, je nach Länge des Kassenzettels.
- **Geschätzte Preise sind geschätzt.** Solange die App deine eigenen Preise nicht kennt, beruhen Sparvorschläge auf allgemeiner Kenntnis des Schweizer Detailhandels. Nach ein paar erfassten Einkäufen werden sie deutlich belastbarer — deshalb lohnt sich das Nachtragen der Preise beim Abschliessen.
- **Die 30 % sind ein Ziel, keine Garantie.** Die Analyse rechnet zusammen, was ihre Massnahmen wirklich bringen, und sagt es, wenn das Ziel nicht aufgeht.
- **Löschst du die Browserdaten**, ist die lokale Liste weg. Mit verbundenem Haushalt holt die App sie zurück; ohne hilft der Export unter Mehr → Daten.
