// Fragen an das zweite Hirn stellen.
//
// Die Auswahl der Notizen passiert lokal (state.chatContext): nur
// was zur Frage passt, geht ueberhaupt zum Server. Die Edge Function
// haelt den Anthropic-Schluessel und antwortet mit Quellenangaben.

import { getConfig } from '../config.js';
import * as store from './state.js';
import * as sync from './sync.js';

/**
 * @returns {Promise<{antwort: string, quellen: string[]}>}
 */
export async function frage(text) {
  const config = getConfig();
  if (!config.chatUrl) {
    throw new Error('Für den Chat fehlt die Verbindung zu Supabase. Siehe Mehr → Verbindung.');
  }

  const token = await sync.accessToken();
  if (!token) {
    throw new Error('Nicht angemeldet. Erst unter Mehr → Sync-Raum verbinden.');
  }

  const notizen = store.chatContext(text);

  // Kurzer Gespraechsfaden, damit Rueckfragen ("und was war das
  // zweite?") funktionieren. Mehr als die letzten Runden braucht es
  // nicht - der Inhalt steckt in den Notizen.
  const verlauf = store.getState().chat.slice(-6).map((m) => ({
    rolle: m.rolle === 'ich' ? 'nutzer' : 'hirn',
    text: String(m.text || '').slice(0, 1500),
  }));

  const response = await fetch(config.chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: config.anonKey,
    },
    body: JSON.stringify({ frage: text, notizen, verlauf }),
  });

  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Unerwartete Antwort (${response.status}). Läuft die Edge Function faden-chat?`);
  }

  if (!response.ok) {
    throw new Error(body?.fehler || `Anfrage fehlgeschlagen (${response.status})`);
  }
  return body.ergebnis;
}
