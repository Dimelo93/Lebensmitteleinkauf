# vendor/

`supabase-js.mjs` ist `@supabase/supabase-js` **2.112.3**, mit esbuild zu einer
einzelnen browsertauglichen ESM-Datei gebündelt.

Warum mitgeliefert statt vom CDN geholt:

- Eine Fehlerquelle weniger. Lud der CDN nicht — Funkloch, Firewall, langsames
  Mobilnetz —, kam die App nicht über „Verbinde …" hinaus, und der Grund war
  von aussen nicht zu erkennen.
- Feste Version. `@2` beim CDN heisst „irgendein 2.x von heute". Diese Fassung
  ist geprüft: sie behandelt die neuen Schlüssel (`sb_publishable_…`) richtig,
  schickt sie also nur im `apikey`-Kopf und nicht als Bearer-Token. Ältere
  Fassungen tun das nicht, und die Anmeldung scheitert dann ohne brauchbare
  Meldung.

Der CDN bleibt als Rückfallebene in `js/sync.js` stehen, falls die Datei
einmal fehlt.

## Neu bauen

```bash
npm install @supabase/supabase-js@2.112.3 esbuild
echo 'export { createClient } from "@supabase/supabase-js";' > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser \
  --target=es2020 --minify --outfile=vendor/supabase-js.mjs
```
