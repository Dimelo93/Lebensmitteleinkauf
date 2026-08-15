# Faden – dein zweites Hirn

Eine Notiz-App nach der Idee von Obsidian – Markdown, `[[Verlinkungen]]`, Backlinks, Tags –, aber gebaut für einen Kopf, der springt. Läuft als Web-App auf dem iPhone-Homescreen und am Laptop, funktioniert offline, gleicht sich über einen Sync-Code zwischen deinen Geräten ab.

Drei Dinge unterscheiden Faden von einem klassischen Zettelkasten:

**Erfassen ohne Entscheidung.** App auf, tippen, fertig. Alles landet im Eingang; erste Zeile wird Titel, `#tags` werden erkannt. Einsortiert wird später – im Aufräum-Modus, ein Zettel aufs Mal, mit vier grossen Knöpfen.

**Der Faden.** Die App merkt sich, welche Notizen du geöffnet hast. Springst du weg – Link, Suche, Ablenkung –, steht unten immer «Zurück zu: …». Das Springen wird ungefährlich, weil der Weg zurück nie verloren geht.

**Ein nächster kleiner Schritt.** Jedes Projekt hat genau einen. Der Fokus-Modus zeigt nur ihn, mit einem Parkplatz für Störgedanken: abladen, weiterarbeiten, der Gedanke wartet im Eingang. Der Fokus überlebt sogar das Schliessen der App – beim nächsten Öffnen stehst du wieder, wo du warst.

## Was drin ist

**Heute** – der Anker: Tagesnotiz, «Weitermachen» (zuletzt berührte Notizen), die nächsten Schritte aller Projekte, der Eingang, dein Faden des Tages.

**Notizen** – Volltextsuche beim Tippen, Filter über Eingang/Angeheftet/Tags. Absichtlich keine Ordner: gesucht und verlinkt wird, nicht einsortiert.

**Markdown** – Titel, Listen, `- [ ]` Häkchen (antippbar), Zitate, Code, fett/kursiv, Weblinks. `[[Titel]]` verlinkt Notizen (mit Autovervollständigung beim Tippen), Backlinks stehen unter jeder Notiz. Ein Link auf eine Notiz, die es noch nicht gibt, legt sie an.

**Projekte** – Liste der offenen Projekte, jedes mit seinem einen Schritt und einem ▶ direkt in den Fokus.

**Fragen** – Chat über deine eigenen Notizen: «Was weiss ich über …?» Die Antwort nennt ihre Quellen, jede ist antippbar. Braucht die Edge Function und einen verbundenen Sync-Raum (unten) und kostet pro Frage ein paar Rappen Anthropic-API.

**Offline und synchron** – alles läuft zuerst lokal auf dem Gerät. Mit einem Sync-Code verbindest du iPhone und Laptop; Änderungen ohne Netz gehen hoch, sobald wieder Netz da ist.

## Loslegen

### 1. Lokal ausprobieren

```bash
python3 -m http.server 8080
```

im **Wurzelverzeichnis des Repos** starten (nicht in faden/ – die App lädt die Supabase-Bibliothek aus ../vendor/), dann `http://localhost:8080/faden/` öffnen. Ohne weitere Einrichtung läuft alles ausser Sync und Chat.

### 2. Ins Netz stellen

Liegt das Repo schon auf GitHub Pages (wie für die Einkaufsliste), ist Faden automatisch dabei: `https://<benutzername>.github.io/<repo>/faden/`

### 3. Aufs iPhone legen

Adresse in **Safari** öffnen, Teilen-Knopf → **Zum Home-Bildschirm**. Faden bekommt ein eigenes Icon neben der Einkaufsliste und startet ohne Browserleiste.

### 4. Geräte verbinden (Sync)

Faden nutzt dasselbe Supabase-Projekt wie die Einkaufsliste, aber eigene Tabellen und einen **eigenen** Sync-Raum – der Haushalts-Code der Einkaufsliste funktioniert hier absichtlich nicht, deine Notizen sind persönlich.

1. In Supabase den **SQL Editor** öffnen und `faden/supabase/schema.sql` in einem Rutsch ausführen.
2. In der App unter **Mehr → Raum anlegen** (erstes Gerät), auf dem zweiten Gerät **Beitreten** mit dem Code.

Die Zugangsdaten in `config.js` sind dieselben wie bei der Einkaufsliste; nichts weiter nötig. Für ein frisches Supabase-Projekt: URL und Publishable Key unter Mehr → Verbindung eintragen und «Anonymous sign-ins» einschalten (Anleitung in ../SUPABASE.md).

### 5. Chat einrichten (optional)

Der Chat läuft über eine Edge Function, damit der Anthropic-Schlüssel nie im Browser landet:

```bash
supabase functions deploy faden-chat --project-ref <projekt-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-… --project-ref <projekt-ref>
```

Der API-Schlüssel kommt von console.anthropic.com. Modell und Aufwand lassen sich per Secret übersteuern (`ANTHROPIC_MODEL`, Standard `claude-sonnet-5`).

Der Chat funktioniert nur mit verbundenem Sync-Raum: die Funktion weist jeden Aufrufer ab, dessen Gerät keinem Raum angehört. Das schützt deinen API-Schlüssel davor, von Fremden als Gratis-Proxy benutzt zu werden – ganz ausschliessen lässt sich das bei einer öffentlichen Web-App ohne Konten nicht, darum lohnt sich ein Blick auf die Nutzungsgrenzen (Spend Limits) in der Anthropic-Konsole.

## Aufbau

```
index.html                    Hülle
config.js                     Supabase-Zugangsdaten (geteilt mit der Einkaufsliste)
manifest.webmanifest, sw.js   PWA: eigenes Icon, eigener Offline-Cache (faden-*)
frisch.html                   Notausgang bei festgefahrenem Cache
css/app.css                   Oberfläche, hell und dunkel
js/
  app.js                      Start, Tabs, Faden-Leiste, Fokus-Verdrahtung
  state.js                    Zustand: Notizen, Eingang, Faden, Fokus, Outbox
  md.js                       Markdown-Renderer (DOM statt innerHTML, XSS-fest)
  sync.js                     Abgleich mit Supabase, Sync-Raum, Realtime
  chat.js                     Aufruf der Edge Function
  ui/                         Ansichten: Heute, Notizen, Projekte, Fragen, Mehr,
                              Editor, Fokus, Erfassen-Leiste, Aufräumen
supabase/
  schema.sql                  Tabellen faden_*, Rechte, Realtime
  functions/faden-chat/       Edge Function für den Chat
icons/                        App-Symbole
```

Keine Abhängigkeiten, kein Build-Schritt. Die Supabase-Bibliothek kommt aus ../vendor/ der Einkaufsliste.

## Grenzen, die du kennen solltest

- **Ohne Supabase kein Sync und kein Chat.** Lokal funktioniert trotzdem alles – Notizen, Links, Suche, Fokus.
- **Der Sync-Code ist der Schlüssel.** Wer ihn hat, liest und schreibt deine Notizen. Nur auf eigenen Geräten eingeben.
- **Der Faden und der Fokus bleiben auf dem Gerät.** Synchronisiert werden die Notizen; wo du gerade denkst, geht den Server nichts an.
- **Jede Chat-Frage kostet** einen Anthropic-API-Aufruf, grob 1 bis 5 Rappen. Die Antwort stützt sich nur auf Notizen, die zur Frage passen – und sagt es, wenn nichts passt.
- **Löschst du die Browserdaten**, sind die lokalen Notizen weg. Mit verbundenem Sync-Raum holt die App sie zurück; ohne hilft der Export unter Mehr → Daten (JSON oder Markdown, auch für Obsidian lesbar).
