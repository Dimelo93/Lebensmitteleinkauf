# Einrichtung: Teilen und Quittungs-Analyse

Zwei getrennte Teile. **Teil A** (Datenbank) reicht fürs Teilen der Liste. **Teil B** (Edge Function) kommt dazu, wenn du Quittungen auswerten willst.

Teil A dauert etwa 10 Minuten und braucht nur einen Browser. Teil B braucht zusätzlich ein Kommandozeilen-Werkzeug und einen Anthropic-API-Schlüssel.

---

## Teil A — Datenbank für die geteilte Liste

### A1. Projekt anlegen

1. [supabase.com](https://supabase.com) öffnen, Konto anlegen (kostenlos, GitHub-Login geht).
2. **New Project**. Name frei wählbar, Region **Frankfurt** oder **Zürich** — kurze Wege, und die Daten bleiben in Europa.
3. Datenbank-Passwort setzen und irgendwo notieren. Du brauchst es für die App nicht, aber Supabase fragt später danach.
4. Ein bis zwei Minuten warten, bis das Projekt bereitsteht.

### A2. Tabellen anlegen

Links im Menü **SQL Editor** → **New query**, dann das Skript einfügen und **Run** drücken. Nach jedem Durchlauf muss unten „Success. No rows returned" stehen.

**Am Rechner:** [`supabase/schema.sql`](supabase/schema.sql) am Stück einfügen, einmal Run, fertig.

**Am Handy:** die vier Teildateien einzeln, in dieser Reihenfolge. Ein 400-Zeilen-Block wird beim Einfügen auf dem Telefon gern abgeschnitten, und Postgres meldet dann „syntax error at end of input".

| Reihenfolge | Datei | Was passiert |
|---|---|---|
| 1 | [`teil1-tabellen.sql`](supabase/teil1-tabellen.sql) | Tabellen und Indizes |
| 2 | [`teil2-funktionen.sql`](supabase/teil2-funktionen.sql) | Funktionen und Trigger |
| 3 | [`teil3-rechte.sql`](supabase/teil3-rechte.sql) | Zugriffsschutz und Rechte |
| 4 | [`teil4-realtime.sql`](supabase/teil4-realtime.sql) | Sofortige Aktualisierung |

Zum Kopieren am Handy eignet sich die Rohfassung besser als die GitHub-Ansicht:
`raw.githubusercontent.com/<benutzer>/<repo>/main/supabase/teil1-tabellen.sql`

Alle Skripte sind wiederholbar — mehrfaches Ausführen schadet nicht. Teil 4 ist der einzige, der scheitern darf: ohne ihn gleicht die App alle 60 Sekunden ab statt sofort.

### A3. Anonyme Anmeldung einschalten

Damit niemand ein Passwort braucht, meldet die App jedes Gerät im Hintergrund anonym an.

1. **Authentication** → **Sign In / Providers**
2. **Anonymous sign-ins** einschalten und speichern.

Ohne diesen Schritt scheitert das Verbinden mit „Anonyme Anmeldung fehlgeschlagen".

### A4. Zugangsdaten in die App

1. **Project Settings** → **API Keys** (Project URL steht unter **Data API**)
2. Zwei Werte kopieren:
   - **Project URL** — `https://xxxxxxxx.supabase.co`, ohne `/rest/v1/` am Ende
   - den **öffentlichen Schlüssel** — heisst je nach Alter des Projekts **Publishable key** (`sb_publishable_…`) oder **anon public** (`eyJ…`). Beide funktionieren.

Dann eines von beidem:

**Variante 1 — in der App eintragen (schnell)**
App öffnen → **Mehr** → **Verbindung** → beide Werte einfügen → Speichern. Gilt nur auf diesem Gerät; jedes weitere Gerät braucht die Werte auch.

**Variante 2 — ins Projekt eintragen (praktischer für die Familie)**
In [`config.js`](config.js) eintragen und pushen:

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_...';
```

Dann ist jedes Gerät automatisch verbunden und braucht nur noch den Haushalts-Code.

> Der **öffentliche Schlüssel** ist dafür gemacht, im Browser zu stehen. Ohne Mitgliedschaft im Haushalt gibt die Datenbank nichts heraus (Row Level Security). Der **geheime Schlüssel** daneben — **Secret key** bzw. **service_role** — umgeht dagegen alle Regeln; der gehört weder in `config.js` noch sonst irgendwohin ins Frontend.

### A5. Haushalt anlegen und teilen

1. In der App: **Mehr** → **Haushalt anlegen**.
2. Du bekommst einen sechsstelligen Code, etwa `K4M7QP`.
3. Auf dem zweiten Gerät die App öffnen, **Mehr** → **Beitreten**, Code eingeben.

Ab jetzt sehen beide dieselbe Liste. Der Status oben rechts zeigt „Synchron".

---

## Teil B — Quittungs-Analyse

Die Analyse ruft die Anthropic-API mit dem Foto auf. Der API-Schlüssel darf dabei **nicht** in die Web-App: alles, was im Browser läuft, kann jeder auslesen. Deshalb läuft der Aufruf in einer Edge Function auf dem Supabase-Server, wo der Schlüssel als Secret liegt.

### B1. API-Schlüssel besorgen

1. [console.anthropic.com](https://console.anthropic.com) → Konto anlegen.
2. Unter **Billing** Guthaben aufladen. Für den Anfang reichen 5 Dollar; eine Quittung kostet grob 5 bis 20 Rappen.
3. **API Keys** → **Create Key**. Der Schlüssel wird nur einmal angezeigt — sofort kopieren.

### B2. Werkzeug installieren

```bash
# macOS
brew install supabase/tap/supabase

# sonst: https://github.com/supabase/cli#install-the-cli
```

### B3. Function hochladen

Im Projektordner:

```bash
supabase login
supabase link --project-ref DEIN_PROJEKT_REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-dein-schluessel
supabase functions deploy analyse-quittung
```

`DEIN_PROJEKT_REF` ist der Teil vor `.supabase.co` in deiner Projekt-URL.

`SUPABASE_URL` und `SUPABASE_ANON_KEY` setzt Supabase in Edge Functions automatisch — die musst du nicht angeben. Die Function prüft damit, dass der Aufrufer angemeldet ist, damit niemand Fremdes deinen API-Schlüssel verbraucht.

### B4. Testen

App → **Budget** → **Quittung fotografieren**. Laden bestätigen, Sparziel wählen, **Analysieren**. Ein langer Kassenzettel braucht 30 bis 60 Sekunden.

Geht etwas schief:

```bash
supabase functions logs analyse-quittung
```

### Was du einstellen kannst

Alle drei sind optional:

```bash
supabase secrets set ANTHROPIC_MODEL=claude-opus-5     # Standard
supabase secrets set ANTHROPIC_EFFORT=high             # low | medium | high | xhigh | max
```

`ANTHROPIC_EFFORT` steuert, wie gründlich gerechnet wird. `medium` ist schneller und günstiger, `high` liest zerknitterte Kassenzettel zuverlässiger. Nach einer Änderung die Function neu hochladen ist nicht nötig, Secrets greifen sofort.

---

## Kosten

| Posten | Kosten |
|---|---|
| Supabase Free | 0 – reicht für eine Familie deutlich aus (500 MB Datenbank, 2 GB Transfer, 500 000 Function-Aufrufe im Monat) |
| Anthropic API | nach Verbrauch, grob 5–20 Rappen pro Quittung |
| Hosting (GitHub Pages) | 0 |

Ohne Quittungs-Analyse fallen überhaupt keine laufenden Kosten an.

---

## Wenn etwas klemmt

**„Anonyme Anmeldung fehlgeschlagen"**
Schritt A3 fehlt — Anonymous sign-ins in Supabase einschalten.

**„Kein Haushalt mit diesem Code gefunden"**
Code prüfen. Gross- und Kleinschreibung sind egal, Leerzeichen auch. Der Code besteht nie aus `O`, `0`, `I` oder `1` — die sind bewusst weggelassen, weil man sie am Telefon verwechselt.

**Status bleibt auf „Verbunden (ohne Live-Update)"**
Realtime ist nicht aktiv. Meist reicht es, `schema.sql` nochmals auszuführen; sonst in Supabase unter **Database → Replication** die Tabellen freigeben. Die App gleicht dann alle 60 Sekunden ab statt sofort — nutzbar bleibt sie.

**Änderungen kommen nicht am anderen Gerät an**
Zählt der Status ausstehende Änderungen (z. B. „Offline · 3"), fehlt die Verbindung. Prüfen, ob beide Geräte im selben Haushalt sind: unter **Mehr** muss auf beiden derselbe Beitrittscode stehen.

**„Auf dem Server fehlt ANTHROPIC_API_KEY"**
`supabase secrets set ANTHROPIC_API_KEY=…` wurde nicht ausgeführt oder nicht für dieses Projekt.

**Analyse bricht mit 401 ab**
Das Gerät ist nicht angemeldet. Erst einem Haushalt beitreten, dann fotografieren.
