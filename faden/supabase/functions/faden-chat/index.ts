// Edge Function: Fragen ueber die eigenen Notizen beantworten.
//
// Warum serverseitig: der Anthropic-API-Schluessel darf nicht in die
// Web-App. Jeder koennte ihn sonst im Browser auslesen und auf deine
// Rechnung Anfragen stellen. Hier liegt er als Supabase-Secret und
// verlaesst den Server nie.
//
// Die Notizen kommen vom Client mit: er waehlt lokal aus, was zur
// Frage passt (faden/js/state.js, chatContext). Die Funktion braucht
// deshalb keinen Datenbankzugriff - sie sieht nur, was die Frage
// betrifft, und vergisst es nach der Antwort wieder.
//
// Deployment: siehe faden/README.md.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// Sonnet reicht hier: die Antwort steht woertlich in den Notizen,
// das Modell muss finden und zusammenfassen, nicht raten. Das haelt
// die Kosten pro Frage klein.
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5';
const EFFORT = Deno.env.get('ANTHROPIC_EFFORT') || 'medium';
const MAX_TOKENS = 4000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ------------------------------------------------------------
// Antwortformat
// ------------------------------------------------------------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['antwort', 'quellen'],
  properties: {
    antwort: {
      type: 'string',
      description: 'Die Antwort auf die Frage, gestuetzt auf die mitgelieferten Notizen. '
        + 'Notiztitel im Text als [[Titel]] schreiben, damit die App sie verlinken kann.',
    },
    quellen: {
      type: 'array',
      description: 'Die Titel der Notizen, auf denen die Antwort beruht - exakt so geschrieben wie im Feld "titel". Leer, wenn keine Notiz etwas hergab.',
      items: { type: 'string' },
    },
  },
};

const SYSTEM_PROMPT = `Du bist das zweite Hirn eines Nutzers mit ADHS: du beantwortest Fragen ausschliesslich aus seinen eigenen Notizen, die dir mitgeliefert werden.

Regeln:
- Antworte NUR aus den mitgelieferten Notizen. Steht die Antwort nicht darin, sag das klar («Dazu steht nichts in deinen Notizen») - erfinde nichts dazu. Allgemeinwissen darfst du nur zum Einordnen verwenden, nie als Ersatz fuer fehlende Notizen.
- Nenne deine Quellen: schreibe Notiztitel im Antworttext als [[Titel]] (exakt wie im Feld "titel" der Notiz) und liste sie zusaetzlich unter "quellen" auf.
- Kurz und direkt, du-Form, Deutsch. Die Antwort zuerst, dann hoechstens ein bis zwei Saetze Kontext. Keine Einleitungen, keine Wiederholung der Frage, keine Belehrungen.
- Der Nutzer springt gedanklich gern - hilf ihm beim Landen: wenn Notizen zusammengehoeren (Verlinkungen, gleiche Tags), sag in einem Satz, was zusammenhaengt.
- Bei Fragen nach Aufgaben oder naechsten Schritten: nenne konkret die Felder "naechster" der Projekte, nicht alles auf einmal - das Wichtigste zuerst, maximal drei Dinge.`;

// ------------------------------------------------------------
// Hilfsfunktionen
// ------------------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Prüft den mitgeschickten Supabase-Login, damit nicht jeder den
 * API-Schlüssel anzapft.
 *
 * Zwei Stufen: die Sitzung muss gültig sein UND zu einem Gerät
 * gehören, das Mitglied eines Faden-Raums ist. Die zweite Prüfung
 * läuft mit dem Token des Aufrufers gegen die RLS-geschützte
 * Tabelle - wer keinem Raum angehört, bekommt eine leere Antwort.
 * Eine frisch erzeugte anonyme Sitzung allein reicht damit nicht;
 * ganz dicht ist das nicht (Räume kann jeder anlegen), aber es
 * hebt die Hürde und macht Missbrauch in den Logs sichtbar.
 */
async function verifyCaller(req: Request): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Lokale Tests ohne Supabase-Umgebung: durchlassen.
    return { ok: true };
  }
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return { ok: false, error: 'Nicht angemeldet' };

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
  });
  if (!res.ok) return { ok: false, error: 'Anmeldung ungültig' };

  const raum = await fetch(`${SUPABASE_URL}/rest/v1/faden_raeume?select=id&limit=1`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
  });
  if (!raum.ok) return { ok: false, error: 'Berechtigung nicht prüfbar' };
  const rows = await raum.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'Erst unter Mehr → Sync-Raum verbinden, dann steht der Chat offen.' };
  }
  return { ok: true };
}

function buildUserContent(payload: any): string {
  const lines: string[] = [];

  const notizen = Array.isArray(payload.notizen) ? payload.notizen.slice(0, 40) : [];
  if (notizen.length) {
    lines.push('Die Notizen des Nutzers, die zur Frage passen koennten:', '```json');
    // Obergrenze gegen versehentlich riesige Anfragen - der Client
    // kuerzt schon, das hier ist der Zaun.
    lines.push(JSON.stringify(notizen).slice(0, 120000));
    lines.push('```');
  } else {
    lines.push('Es wurden keine passenden Notizen gefunden. Sag dem Nutzer ehrlich, dass dazu nichts in seinen Notizen steht.');
  }

  const verlauf = Array.isArray(payload.verlauf) ? payload.verlauf.slice(-6) : [];
  if (verlauf.length) {
    lines.push('\nDas bisherige Gespraech (nur als Kontext fuer Rueckbezuege):');
    for (const m of verlauf) {
      const wer = m?.rolle === 'nutzer' ? 'Nutzer' : 'Du';
      lines.push(`${wer}: ${String(m?.text ?? '').slice(0, 1500)}`);
    }
  }

  lines.push(`\nDie Frage des Nutzers: ${String(payload.frage ?? '').slice(0, 2000)}`);
  return lines.join('\n');
}

// ------------------------------------------------------------
// Aufruf des Modells
// ------------------------------------------------------------

async function callClaude(content: string, withFallback: boolean) {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [{ role: 'user', content }],
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  };

  // Sicherheitsnetz: lehnt der Klassifikator eine Anfrage ab, beantwortet
  // sie ein Ausweichmodell im selben Aufruf, statt dass der Nutzer eine
  // leere Antwort bekommt.
  if (withFallback) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const err: any = new Error(text);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

// ------------------------------------------------------------
// Einstiegspunkt
// ------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ fehler: 'Nur POST' }, 405);

  if (!ANTHROPIC_API_KEY) {
    return json({ fehler: 'Auf dem Server fehlt ANTHROPIC_API_KEY. Siehe faden/README.md.' }, 500);
  }

  const auth = await verifyCaller(req);
  if (!auth.ok) return json({ fehler: auth.error }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ fehler: 'Ungültige Anfrage' }, 400);
  }

  if (!String(payload?.frage ?? '').trim()) {
    return json({ fehler: 'Keine Frage empfangen' }, 400);
  }

  const content = buildUserContent(payload);

  try {
    let response;
    try {
      response = await callClaude(content, true);
    } catch (err: any) {
      // Ist die Fallback-Beta fuer dieses Konto nicht freigeschaltet,
      // laeuft der Chat trotzdem - einfach ohne Ausweichmodell.
      if (err?.status === 400 && String(err.body ?? '').includes('fallback')) {
        response = await callClaude(content, false);
      } else {
        throw err;
      }
    }

    if (response.stop_reason === 'refusal') {
      return json({ fehler: 'Die Anfrage wurde abgelehnt. Formuliere die Frage anders.' }, 422);
    }

    const textBlock = (response.content ?? []).find((b: any) => b.type === 'text');
    if (!textBlock?.text) {
      return json({ fehler: 'Leere Antwort vom Modell' }, 502);
    }

    let ergebnis;
    try {
      ergebnis = JSON.parse(textBlock.text);
    } catch {
      return json({ fehler: 'Antwort war kein gültiges JSON', roh: textBlock.text.slice(0, 2000) }, 502);
    }

    return json({
      ergebnis,
      meta: {
        modell: response.model,
        stop: response.stop_reason,
        tokens: {
          ein: response.usage?.input_tokens ?? null,
          aus: response.usage?.output_tokens ?? null,
        },
      },
    });
  } catch (err: any) {
    console.error('Chat fehlgeschlagen', err?.status, err?.message);
    const status = err?.status === 429 ? 429 : 502;
    const meldung = err?.status === 429
      ? 'Zu viele Anfragen. Kurz warten und nochmal.'
      : 'Die Anfrage ist fehlgeschlagen. Details stehen im Function-Log.';
    return json({ fehler: meldung }, status);
  }
});
