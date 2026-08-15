// Verbindungsdaten zu Supabase.
//
// Faden nutzt dasselbe Supabase-Projekt wie die Einkaufsliste, aber
// eigene Tabellen (faden_*) und einen eigenen Sync-Raum. Der
// Beitrittscode des Einkaufs-Haushalts funktioniert hier bewusst
// nicht: Notizen sind persoenlich, die Einkaufsliste ist geteilt.
//
// Der anon key ist ausdruecklich fuer den Browser gedacht und darf
// oeffentlich sein: ohne Mitgliedschaft im Raum gibt die Datenbank
// nichts heraus (Row Level Security, siehe supabase/schema.sql).
// Der service_role key gehoert NIEMALS hierher.

export const SUPABASE_URL = 'https://gcccvgocheecypimwfcw.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_InFapB_LjSPkHOtTnTqRoQ_1z4AWMGc';

// Adresse der Edge Function fuer den Chat ueber die Notizen. Leer
// lassen: dann wird automatisch <SUPABASE_URL>/functions/v1/faden-chat
// verwendet.
export const CHAT_FUNCTION_URL = '';

const OVERRIDE_KEY = 'faden.config';

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
  const chatUrl = (local.chatUrl ?? CHAT_FUNCTION_URL ?? '').trim()
    || (url ? `${url}/functions/v1/faden-chat` : '');
  return {
    url,
    anonKey,
    chatUrl,
    configured: Boolean(url && anonKey),
    // Ein Eintrag unter Mehr -> Verbindung ueberschreibt die Werte
    // aus dem Projekt, und zwar dauerhaft. Deshalb ausweisen, woher
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
