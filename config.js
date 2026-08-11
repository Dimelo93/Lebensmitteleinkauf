// Verbindungsdaten zu Supabase.
//
// Zwei Wege, beide gleichwertig:
//
//  A) Hier eintragen und committen. Dann ist die App fuer alle,
//     die den Link haben, sofort verbunden - sie brauchen nur
//     noch den Haushalts-Code.
//
//  B) Leer lassen und die Werte in der App unter Einstellungen ->
//     Verbindung einfuegen. Sie liegen dann nur auf dem Geraet.
//
// Der anon key ist ausdruecklich fuer den Browser gedacht und
// darf oeffentlich sein: ohne Mitgliedschaft im Haushalt gibt die
// Datenbank nichts heraus (Row Level Security, siehe
// supabase/schema.sql). Der service_role key gehoert NIEMALS
// hierher.

export const SUPABASE_URL = 'https://gcccvgocheecypimwfcw.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_InFapB_LjSPkHOtTnTqRoQ_1z4AWMGc';

// Adresse der Edge Function fuer die Quittungs-Analyse. Leer
// lassen: dann wird automatisch <SUPABASE_URL>/functions/v1/analyse-quittung
// verwendet.
export const ANALYSE_FUNCTION_URL = '';

const OVERRIDE_KEY = 'lebensmittel.config';

function overrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getConfig() {
  const local = overrides();
  const url = (local.url ?? SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (local.anonKey ?? SUPABASE_ANON_KEY ?? '').trim();
  const analyseUrl = (local.analyseUrl ?? ANALYSE_FUNCTION_URL ?? '').trim()
    || (url ? `${url}/functions/v1/analyse-quittung` : '');
  return {
    url,
    anonKey,
    analyseUrl,
    configured: Boolean(url && anonKey),
    // Ein Eintrag unter Mehr -> Verbindung ueberschreibt die Werte
    // aus dem Projekt, und zwar dauerhaft. Ein alter, halb getippter
    // Schluessel von einem frueheren Versuch verdeckt so den
    // richtigen - ohne dass man es sieht. Deshalb ausweisen, woher
    // die Werte kommen.
    ausProjekt: local.url == null && local.anonKey == null,
  };
}

export function setConfig(patch) {
  const next = { ...overrides(), ...patch };
  for (const [key, value] of Object.entries(next)) {
    if (value == null || value === '') delete next[key];
  }
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
  return getConfig();
}

export function clearConfig() {
  localStorage.removeItem(OVERRIDE_KEY);
  return getConfig();
}
