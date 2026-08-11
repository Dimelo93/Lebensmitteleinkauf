// Edge Function: Quittungsfoto auslesen und Sparpotenzial finden.
//
// Warum serverseitig: der Anthropic-API-Schluessel darf nicht in die
// Web-App. Jeder koennte ihn sonst im Browser auslesen und auf deine
// Rechnung Anfragen stellen. Hier liegt er als Supabase-Secret und
// verlaesst den Server nie.
//
// Deployment: siehe SUPABASE.md, Abschnitt "Quittungs-Analyse".

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// Opus 5 ist hier die richtige Wahl: eine zerknitterte Quittung mit
// Abkuerzungen wie "M-BUDGET POULETBRUST 480G" zu lesen UND daraus
// brauchbare Sparvorschlaege abzuleiten ist genau die Art Aufgabe,
// bei der ein schwaecheres Modell Preise verwechselt.
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-5';
const EFFORT = Deno.env.get('ANTHROPIC_EFFORT') || 'high';
const MAX_TOKENS = 16000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ------------------------------------------------------------
// Antwortformat
// ------------------------------------------------------------
// Strukturierte Ausgabe statt Fliesstext: die App bekommt immer
// dieselben Felder und muss nichts aus Prosa herausparsen.

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['laden', 'datum', 'waehrung', 'summe', 'positionen', 'auffaelligkeiten', 'alternativen', 'sparplan', 'hinweise'],
  properties: {
    laden: { type: ['string', 'null'], description: 'Name des Ladens laut Quittung, z. B. Migros, Coop, Lidl, Aldi.' },
    datum: { type: ['string', 'null'], description: 'Einkaufsdatum im Format JJJJ-MM-TT, falls auf der Quittung erkennbar.' },
    waehrung: { type: 'string', description: 'Währungscode, in der Schweiz CHF.' },
    summe: { type: ['number', 'null'], description: 'Gesamtsumme laut Quittung.' },
    positionen: {
      type: 'array',
      description: 'Alle Einzelposten der Quittung, in der Reihenfolge wie abgedruckt.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'menge', 'einheit', 'preis', 'einzelpreis', 'kategorie', 'unsicher'],
        properties: {
          name: { type: 'string', description: 'Artikelname, ausgeschriebene Abkürzungen wo eindeutig.' },
          menge: { type: ['number', 'null'], description: 'Menge, falls angegeben.' },
          einheit: { type: ['string', 'null'], description: 'Einheit: Stk, g, kg, ml, l.' },
          preis: { type: ['number', 'null'], description: 'Bezahlter Gesamtpreis dieser Position.' },
          einzelpreis: { type: ['number', 'null'], description: 'Preis pro Einheit, falls berechenbar (Preis geteilt durch Menge).' },
          kategorie: {
            type: 'string',
            enum: ['gemuese', 'fleisch', 'molkerei', 'brot', 'tiefkuehl', 'vorrat', 'konserven', 'getraenke', 'snacks', 'haushalt', 'drogerie', 'sonstiges'],
            description: 'Warengruppe.',
          },
          unsicher: { type: 'boolean', description: 'true, wenn Name oder Preis auf dem Foto schlecht lesbar war.' },
        },
      },
    },
    auffaelligkeiten: {
      type: 'array',
      description: 'Wo ging überdurchschnittlich viel Geld hin. Die teuersten und die im Verhältnis unnötigsten Posten.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'begruendung', 'betrag'],
        properties: {
          titel: { type: 'string' },
          begruendung: { type: 'string', description: 'Warum dieser Posten auffällt. Konkret, mit Zahlen aus der Quittung.' },
          betrag: { type: ['number', 'null'], description: 'Der betroffene Betrag in Franken.' },
        },
      },
    },
    alternativen: {
      type: 'array',
      description: 'Konkrete günstigere Alternativen zu einzelnen Posten.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statt', 'empfehlung', 'laden', 'ersparnis', 'sicherheit', 'begruendung'],
        properties: {
          statt: { type: 'string', description: 'Der Artikel von der Quittung.' },
          empfehlung: { type: 'string', description: 'Was stattdessen: Eigenmarke, andere Menge, anderes Produkt.' },
          laden: { type: ['string', 'null'], description: 'Wo, falls ein Ladenwechsel Teil des Vorschlags ist.' },
          ersparnis: { type: ['number', 'null'], description: 'Geschätzte Ersparnis in Franken bei diesem Einkauf.' },
          sicherheit: {
            type: 'string',
            enum: ['belegt', 'geschaetzt', 'unsicher'],
            description: 'belegt = aus der mitgelieferten Preishistorie des Haushalts, geschaetzt = Erfahrungswert, unsicher = grobe Schätzung.',
          },
          begruendung: { type: 'string' },
        },
      },
    },
    sparplan: {
      type: 'object',
      additionalProperties: false,
      required: ['ziel_prozent', 'erreichbar_prozent', 'summe_neu', 'massnahmen', 'fazit'],
      properties: {
        ziel_prozent: { type: 'number', description: 'Das angefragte Sparziel in Prozent.' },
        erreichbar_prozent: { type: 'number', description: 'Was mit den aufgeführten Massnahmen tatsächlich zusammenkommt. Ehrlich rechnen, nicht auf das Ziel hinbiegen.' },
        summe_neu: { type: ['number', 'null'], description: 'Rechnungssumme, wenn alle Massnahmen umgesetzt würden.' },
        massnahmen: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['titel', 'beschreibung', 'ersparnis', 'aufwand'],
            properties: {
              titel: { type: 'string' },
              beschreibung: { type: 'string' },
              ersparnis: { type: ['number', 'null'], description: 'Ersparnis in Franken bei diesem Einkauf.' },
              aufwand: { type: 'string', enum: ['klein', 'mittel', 'gross'], description: 'Wie viel Umstellung das kostet.' },
            },
          },
        },
        fazit: { type: 'string', description: 'Zwei bis drei Sätze: was bringt wirklich etwas, und was fehlt zum Ziel.' },
      },
    },
    hinweise: {
      type: 'array',
      description: 'Was nicht gelesen werden konnte oder unsicher ist. Leer lassen, wenn alles klar war.',
      items: { type: 'string' },
    },
  },
};

const SYSTEM_PROMPT = `Du wertest Kassenzettel aus Schweizer Lebensmittelgeschäften aus und findest heraus, wo das Geld hingeht und wie sich die Rechnung senken lässt.

Reihenfolge deiner Arbeit:
1. Lies die Quittung Position für Position ab. Schweizer Kassenzettel kürzen stark ab (M-CLASSIC, M-BUDGET, PRIX GARANTIE, QUALITÉ&PRIX, AGRI NATURA, ZWEIFEL, RAMSEIER). Schreibe erkennbare Abkürzungen aus, aber erfinde nichts dazu. Was du nicht sicher lesen kannst, markierst du mit "unsicher": true und erwähnst es unter "hinweise".
2. Rechne pro Position den Einzelpreis aus, wo Menge und Preis dastehen. 500 g für 12.50 sind 25.00 pro Kilo — dieser Umrechnung wegen wird ein Vergleich überhaupt erst möglich.
3. Suche die Posten, die den grössten Anteil der Rechnung ausmachen, und die, bei denen der Einzelpreis auffällig hoch ist.
4. Schlage konkrete Alternativen vor.
5. Rechne einen Sparplan zum angefragten Ziel.

Regeln für die Preise:
- Wenn dir eine Preishistorie des Haushalts mitgeliefert wird, ist sie deine wichtigste Quelle. Sie enthält echte bezahlte Preise dieses Haushalts pro Laden. Vorschläge, die darauf beruhen, markierst du mit "belegt" und nennst die Zahl.
- Ohne solche Daten schätzt du aus allgemeiner Kenntnis des Schweizer Detailhandels und markierst mit "geschaetzt".
- Erfinde niemals einen konkreten Preis und behaupte, er sei belegt. Ein ehrliches "geschaetzt" ist brauchbar, eine erfundene Zahl ist schlimmer als gar keine.

Regeln für den Sparplan:
- Rechne die Massnahmen zusammen und nenne die Summe, die tatsächlich herauskommt. Wenn das Ziel nicht erreichbar ist, sag das und nenne die Zahl, die erreichbar ist. Biege nichts auf das Wunschprozent hin.
- Sortiere nach Wirkung: was am meisten bringt, kommt zuerst.
- Typische Hebel in der Schweiz, in dieser Reihenfolge der Wirkung: Eigenmarken statt Markenprodukte (M-Budget, Prix Garantie, Aldi/Lidl-Eigenmarken sparen oft 30 bis 50 Prozent), Fleisch reduzieren oder den Metzger statt Fertigpackungen, Grosspackungen bei Haltbarem, Aktionen und Ablaufrabatte, Discounter für Grundnahrungsmittel und Migros/Coop nur für das Spezielle, weniger Fertigprodukte und Getränke.
- Berücksichtige, was auf der Quittung wirklich steht. Ein Sparvorschlag zu Fleisch ist wertlos, wenn kein Fleisch gekauft wurde.

Sprache: Deutsch, du-Form, direkt und ohne Floskeln. Keine Einleitung, keine allgemeinen Ernährungstipps, keine Belehrungen über gesunde Ernährung. Der Nutzer will Zahlen und Handlungen.`;

// ------------------------------------------------------------
// Hilfsfunktionen
// ------------------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Prüft den mitgeschickten Supabase-Login, damit nicht jeder den API-Schlüssel anzapft. */
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
  return { ok: true };
}

function buildUserContent(payload: any) {
  const blocks: any[] = [];

  const images = Array.isArray(payload.images) ? payload.images : payload.image ? [payload.image] : [];
  for (const image of images.slice(0, 5)) {
    if (!image?.data) continue;
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.media_type || 'image/jpeg',
        // Data-URL-Präfix abschneiden, falls die App eines mitschickt.
        data: String(image.data).replace(/^data:[^,]+,/, ''),
      },
    });
  }

  const ziel = Number(payload.zielProzent) || 30;
  const lines = [
    `Werte diese Quittung aus. Sparziel: ${ziel} Prozent der Rechnungssumme.`,
  ];

  if (payload.laden) lines.push(`Der Nutzer sagt, der Einkauf war bei: ${payload.laden}.`);
  if (payload.notiz) lines.push(`Notiz des Nutzers: ${payload.notiz}`);

  if (Array.isArray(payload.laeden) && payload.laeden.length) {
    lines.push(`\nLäden, in die dieser Haushalt tatsächlich geht (nur diese als Alternative vorschlagen): ${payload.laeden.join(', ')}.`);
  }

  if (Array.isArray(payload.preishistorie) && payload.preishistorie.length) {
    lines.push(
      '\nBisher bezahlte Preise dieses Haushalts (echte Daten, als "belegt" verwendbar). Format: Artikel, dann je Laden der zuletzt bezahlte Preis und der Durchschnitt:',
      '```json',
      JSON.stringify(payload.preishistorie).slice(0, 20000),
      '```',
    );
  } else {
    lines.push('\nEs liegen noch keine eigenen Preisdaten dieses Haushalts vor. Markiere Preisangaben entsprechend als geschätzt.');
  }

  if (payload.monatsbudget) {
    lines.push(`\nMonatsbudget des Haushalts für Lebensmittel: CHF ${payload.monatsbudget}.`);
  }

  blocks.push({ type: 'text', text: lines.join('\n') });
  return blocks;
}

// ------------------------------------------------------------
// Aufruf des Modells
// ------------------------------------------------------------

async function callClaude(content: any[], withFallback: boolean) {
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
    return json({ fehler: 'Auf dem Server fehlt ANTHROPIC_API_KEY. Siehe SUPABASE.md.' }, 500);
  }

  const auth = await verifyCaller(req);
  if (!auth.ok) return json({ fehler: auth.error }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ fehler: 'Ungültige Anfrage' }, 400);
  }

  const content = buildUserContent(payload);
  if (!content.some((block) => block.type === 'image')) {
    return json({ fehler: 'Kein Bild empfangen' }, 400);
  }

  try {
    let response;
    try {
      response = await callClaude(content, true);
    } catch (err: any) {
      // Ist die Fallback-Beta für dieses Konto nicht freigeschaltet,
      // laeuft die Analyse trotzdem - einfach ohne Ausweichmodell.
      if (err?.status === 400 && String(err.body ?? '').includes('fallback')) {
        response = await callClaude(content, false);
      } else {
        throw err;
      }
    }

    if (response.stop_reason === 'refusal') {
      return json({ fehler: 'Die Analyse wurde abgelehnt. Versuch es mit einem anderen Foto.' }, 422);
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
    console.error('Analyse fehlgeschlagen', err?.status, err?.message);
    const status = err?.status === 429 ? 429 : 502;
    const meldung = err?.status === 429
      ? 'Zu viele Anfragen an die Analyse. Kurz warten und nochmal.'
      : 'Die Analyse ist fehlgeschlagen. Details stehen im Function-Log.';
    return json({ fehler: meldung }, status);
  }
});
