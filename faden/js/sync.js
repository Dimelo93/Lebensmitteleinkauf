// Abgleich mit Supabase.
//
// Ablauf wie bei der Einkaufsliste: anonym anmelden (kein Passwort,
// das Konto haengt am Geraet) -> Sync-Raum anlegen oder per Code
// beitreten -> alles einmal ziehen -> Outbox hochschieben -> auf
// Realtime-Ereignisse hoeren. Faellt irgendetwas davon aus, laeuft
// die App lokal weiter und holt den Rueckstand beim naechsten Mal.
//
// Der Sync-Raum ist dasselbe Muster wie der Haushalt der
// Einkaufsliste, aber ein eigener: Notizen sind persoenlich. Den
// Code gibt man nur auf den eigenen Geraeten ein.

import { getConfig } from '../config.js';
import * as store from './state.js';
import { nowIso } from './util.js';

// Die mitgelieferte Fassung der Einkaufsliste zuerst - gleiche
// Bibliothek, gleicher Server, und im Funkloch schon im Cache.
const LIBRARY_URLS = [
  new URL('../../vendor/supabase-js.mjs', import.meta.url).href,
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'https://esm.sh/@supabase/supabase-js@2',
  'https://unpkg.com/@supabase/supabase-js@2/dist/module/index.js',
];

const PULL_INTERVAL_MS = 60_000;

let client = null;
let channel = null;
let pullTimer = null;
let pushing = false;
let statusValue = { state: 'local', detail: 'Nur auf diesem Gerät' };
const statusListeners = new Set();

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(statusValue);
  return () => statusListeners.delete(fn);
}

function setStatus(state, detail) {
  statusValue = { state, detail, pending: store.outboxSize(), at: nowIso() };
  for (const fn of statusListeners) {
    try {
      fn(statusValue);
    } catch (err) {
      console.error(err);
    }
  }
}

export const getStatus = () => statusValue;

/** Selbstauskunft fuer die Einstellungen - siehe Einkaufsliste. */
export async function diagnose() {
  const config = getConfig();
  const report = {
    url: config.url || '(leer)',
    schluessel: kuerze(config.anonKey),
    quelle: config.ausProjekt ? 'aus dem Projekt' : 'auf diesem Gerät gespeichert',
    bibliothek: '…',
    sitzung: '…',
    status: statusValue.detail || statusValue.state,
  };

  try {
    await loadLibrary();
    report.bibliothek = 'geladen';
  } catch (err) {
    report.bibliothek = `nicht erreichbar (${err.message || 'unbekannt'})`;
  }

  try {
    if (!client) {
      report.sitzung = 'keine Verbindung';
    } else {
      const { data } = await client.auth.getSession();
      const session = data?.session ?? null;
      if (!session) {
        report.sitzung = 'nicht angemeldet';
      } else if (session.expires_at == null) {
        report.sitzung = 'angemeldet';
      } else {
        const restMin = Math.round((session.expires_at * 1000 - Date.now()) / 60000);
        report.sitzung = restMin > 0
          ? `angemeldet, noch ${restMin} min gültig`
          : `abgelaufen seit ${Math.abs(restMin)} min`;
      }
    }
  } catch (err) {
    report.sitzung = `Fehler (${err.message || 'unbekannt'})`;
  }

  return report;
}

/** Genug zum Wiedererkennen, nicht genug zum Mitlesen. */
function kuerze(key) {
  const text = String(key ?? '');
  if (!text) return '(leer)';
  if (text.length <= 14) return `${text.length} Zeichen`;
  return `${text.slice(0, 8)}…${text.slice(-4)} · ${text.length} Zeichen`;
}

/** Verbindung verwerfen und von vorn aufbauen. */
export async function reconnect() {
  if (client && channel) {
    await client.removeChannel(channel).catch(() => {});
    channel = null;
  }
  client = null;
  return connect();
}

// ------------------------------------------------------------
// Spaltenabbildung lokal <-> Datenbank
// ------------------------------------------------------------
// Bewusst explizit: so landet garantiert keine lokale Hilfsspalte
// (etwa "besucht" oder der Faden) in Postgres. Was hier nicht steht,
// bleibt auf dem Geraet.

const COLUMNS = {
  faden_notizen: {
    id: 'id', titel: 'titel', text: 'text', typ: 'typ', status: 'status',
    naechster: 'naechster', inbox: 'inbox', tags: 'tags', angeheftet: 'angeheftet',
    deleted: 'geloescht', erstellt: 'erstellt', updatedAt: 'updated_at',
  },
};

function toRemote(table, row, raumId) {
  const map = COLUMNS[table];
  const out = { raum_id: raumId };
  for (const [local, remote] of Object.entries(map)) {
    if (row[local] !== undefined) out[remote] = row[local];
  }
  if (out.updated_at == null) out.updated_at = nowIso();
  return out;
}

function toLocal(table, row) {
  const map = COLUMNS[table];
  const out = {};
  for (const [local, remote] of Object.entries(map)) {
    if (row[remote] !== undefined) out[local] = row[remote];
  }
  if (!Array.isArray(out.tags)) out.tags = [];
  return out;
}

// ------------------------------------------------------------
// Client aufbauen
// ------------------------------------------------------------

/**
 * Neue Supabase-Schluessel (sb_publishable_…) aus dem
 * Authorization-Kopf halten - Begruendung und Details in der
 * Einkaufsliste (js/sync.js): supabase-js schickt sie faelschlich
 * als Bearer-Token, und der Anmeldedienst scheitert daran.
 */
function baueFetch(anonKey) {
  if (!/^sb_(publishable|secret)_/.test(String(anonKey))) return undefined;

  const verboten = `Bearer ${anonKey}`;
  return async (input, init) => {
    const anfrage = new Request(input, init);
    if (anfrage.headers.get('Authorization') === verboten) {
      anfrage.headers.delete('Authorization');
    }
    return fetch(anfrage);
  };
}

async function loadLibrary() {
  let lastError = null;
  for (const url of LIBRARY_URLS) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod?.createClient) return mod;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('supabase-js konnte nicht geladen werden');
}

/**
 * Baut die Verbindung auf. Ohne Konfiguration passiert nichts -
 * die App bleibt im lokalen Modus, ohne Fehlermeldung.
 */
export async function connect() {
  const config = getConfig();
  if (!config.configured) {
    setStatus('local', 'Nur auf diesem Gerät');
    return null;
  }

  if (!navigator.onLine) {
    setStatus('offline', 'Offline – Änderungen werden gemerkt');
    return null;
  }

  try {
    setStatus('connecting', 'Verbinde …');
    const { createClient } = await loadLibrary();

    // Eigener storageKey: Faden und Einkaufsliste teilen sich den
    // localStorage der Domain. Mit demselben Schluessel wuerden sich
    // die beiden Apps gegenseitig die Sitzung ueberschreiben.
    const sb = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'faden.auth' },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { fetch: baueFetch(config.anonKey) },
    });

    let { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) throw new Error(erklaereAnmeldefehler(error));
      ({ data: sessionData } = await sb.auth.getSession());
    }
    if (!sessionData?.session) {
      throw new Error('Die Anmeldung kam ohne Sitzung zurück. Steht in Supabase unter '
        + 'Authentication → Sign In / Providers der Schalter "Anonymous sign-ins" auf an?');
    }

    client = sb;

    const raum = store.getState().raum;
    if (raum?.id) {
      await afterRaum(raum);
    } else {
      // Vielleicht ist dieses Geraet schon Mitglied - dann den Raum
      // uebernehmen, statt einen zweiten anzulegen.
      const { data } = await client.rpc('faden_meine_raeume');
      if (data?.length) {
        const found = { id: data[0].id, name: data[0].name, joinCode: data[0].beitrittscode };
        store.setRaum(found);
        await afterRaum(found);
      } else {
        setStatus('ready', 'Verbunden – noch kein Sync-Raum');
      }
    }
    return client;
  } catch (err) {
    // Zuruecksetzen, damit der naechste Versuch wirklich neu aufbaut.
    client = null;
    console.warn('Verbindung fehlgeschlagen', err);
    setStatus('error', err.message || 'Verbindung fehlgeschlagen');
    return null;
  }
}

/** Aus der Meldung von Supabase eine machen, mit der man etwas anfangen kann. */
function erklaereAnmeldefehler(error) {
  const text = String(error?.message ?? '');

  if (/anonymous/i.test(text) && /disabled|not enabled|forbidden/i.test(text)) {
    return 'Anonyme Anmeldung ist in Supabase noch ausgeschaltet. Dort unter '
      + 'Authentication → Sign In / Providers den Schalter "Anonymous sign-ins" '
      + 'einschalten und speichern, dann hier neu laden.';
  }
  if (/signups? not allowed|signup.*disabled/i.test(text)) {
    return 'Supabase lässt gerade keine neuen Anmeldungen zu. Unter '
      + 'Authentication → Sign In / Providers "Allow new users to sign up" '
      + 'und "Anonymous sign-ins" einschalten.';
  }
  if (/invalid api key|no api key|apikey/i.test(text)) {
    return 'Supabase weist den Schlüssel ab. Unter Project Settings → API Keys den '
      + 'öffentlichen Schlüssel (Publishable bzw. anon) nochmals kopieren.';
  }
  if (/captcha/i.test(text)) {
    return 'Supabase verlangt ein Captcha. Unter Authentication → Settings die '
      + 'Captcha-Prüfung ausschalten.';
  }
  return `Anonyme Anmeldung fehlgeschlagen: ${text}`;
}

export function isConnected() {
  return Boolean(client);
}

/** Zugriffstoken des angemeldeten Geraets - der Chat weist sich damit
 *  bei der Edge Function aus. */
export async function accessToken() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session?.access_token ?? null;
}

export async function requireClient() {
  if (client) return client;
  return connect();
}

// Wie lange vor Ablauf schon erneuert wird.
const SITZUNG_PUFFER_MS = 120_000;

/**
 * Eine Sitzung besorgen, die auch wirklich noch gilt. Anonyme
 * Sitzungen laufen nach einer Stunde ab; auf dem Telefon haelt iOS
 * die Auffrischung im Hintergrund an. Begruendung im Detail: js/sync.js
 * der Einkaufsliste.
 */
async function ensureSession(sb) {
  const { data } = await sb.auth.getSession();
  const session = data?.session ?? null;

  const laeuftBald = session?.expires_at != null
    && session.expires_at * 1000 - Date.now() < SITZUNG_PUFFER_MS;

  if (session && !laeuftBald) return session;

  if (session) {
    const { data: erneuert } = await sb.auth.refreshSession();
    if (erneuert?.session) return erneuert.session;
  }

  // Auffrischen ging nicht. Neu anmelden ergibt eine neue Kennung -
  // deshalb gleich wieder in den Raum eintreten; der Beitrittscode
  // liegt lokal. Er ist das eigentliche Kennwort.
  const { data: frisch, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error(erklaereAnmeldefehler(error));
  if (!frisch?.session) {
    throw new Error('Die Anmeldung kam ohne Sitzung zurück. Steht in Supabase unter '
      + 'Authentication → Sign In / Providers der Schalter "Anonymous sign-ins" auf an?');
  }

  const code = store.getState().raum?.joinCode;
  if (code) {
    const { error: beitritt } = await sb.rpc('faden_raum_beitreten', { code });
    if (beitritt) console.warn('Wiedereintritt in den Raum fehlgeschlagen', beitritt.message);
  }

  return frisch.session;
}

async function requireSession() {
  const sb = await requireClient();
  if (!sb) throw new Error(verbindungsGrund());
  await ensureSession(sb);
  return sb;
}

function verbindungsGrund() {
  return statusValue.state === 'error' && statusValue.detail
    ? statusValue.detail
    : 'Keine Verbindung zu Supabase';
}

// ------------------------------------------------------------
// Sync-Raum
// ------------------------------------------------------------

export async function createRaum(name) {
  const sb = await requireSession();
  const { data, error } = await sb.rpc('faden_raum_anlegen', { raum_name: name || 'Mein Faden' });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const raum = { id: row.id, name: row.name, joinCode: row.beitrittscode };
  store.setRaum(raum);
  await afterRaum(raum);
  return raum;
}

export async function joinRaum(code) {
  const sb = await requireSession();
  const { data, error } = await sb.rpc('faden_raum_beitreten', { code });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const raum = { id: row.id, name: row.name, joinCode: row.beitrittscode };
  store.setRaum(raum);
  await afterRaum(raum);
  return raum;
}

export async function leaveRaum() {
  if (client) {
    await client.removeChannel(channel).catch(() => {});
    channel = null;
  }
  store.setRaum(null);
  setStatus('local', 'Nur auf diesem Gerät');
}

async function afterRaum(raum) {
  await pull();
  await push();
  subscribeRealtime(raum.id);
  startPolling();
  setStatus('online', `Verbunden · ${raum.name}`);
}

// ------------------------------------------------------------
// Ziehen und Schieben
// ------------------------------------------------------------

export async function pull() {
  const raum = store.getState().raum;
  if (!client || !raum?.id) return 0;

  try {
    await ensureSession(client);
  } catch (err) {
    setStatus('error', err.message || 'Anmeldung abgelaufen');
    return 0;
  }

  let count = 0;
  // Seitenweise ziehen: Supabase kappt Antworten standardmaessig bei
  // 1000 Zeilen - ohne Schleife saehe ein Geraet ab dann nur noch
  // einen stillen Teilbestand.
  const SEITE = 1000;
  for (const table of store.SYNCED_TABLES) {
    for (let von = 0; ; von += SEITE) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .eq('raum_id', raum.id)
        .order('id')
        .range(von, von + SEITE - 1);
      if (error) {
        console.warn(`Konnte ${table} nicht laden`, error.message);
        break;
      }
      for (const row of data ?? []) {
        if (store.applyRemoteRow(table, toLocal(table, row))) count += 1;
      }
      if ((data?.length ?? 0) < SEITE) break;
    }
  }
  store.markPulled();
  return count;
}

export async function push() {
  const raum = store.getState().raum;
  if (!client || !raum?.id || pushing) return 0;
  if (!store.outboxSize()) return 0;

  try {
    await ensureSession(client);
  } catch (err) {
    setStatus('error', err.message || 'Anmeldung abgelaufen');
    return 0;
  }

  pushing = true;
  // Nur ansehen, nicht leeren: ausgetragen wird ein Eintrag erst,
  // wenn der Server den Upsert bestaetigt hat. Stirbt die App mitten
  // im Senden, bleibt die Vormerkung erhalten.
  const batch = store.peekOutbox();
  let sent = 0;
  try {
    // Nach Tabelle buendeln, damit aus 30 Notizen ein Request wird.
    const byTable = new Map();
    for (const entry of batch) {
      if (!byTable.has(entry.table)) byTable.set(entry.table, []);
      byTable.get(entry.table).push(entry);
    }

    for (const table of store.SYNCED_TABLES) {
      const entries = byTable.get(table);
      if (!entries?.length) continue;
      const rows = entries.map((entry) => toRemote(table, entry.row, raum.id));
      const { error } = await client.from(table).upsert(rows);
      if (error) {
        console.warn(`Konnte ${table} nicht senden`, error.message);
      } else {
        store.confirmOutbox(entries);
        sent += entries.length;
      }
    }
    setStatus(statusValue.state === 'online' ? 'online' : 'ready', statusValue.detail);
    return sent;
  } catch (err) {
    console.warn('Senden fehlgeschlagen', err);
    setStatus('error', 'Senden fehlgeschlagen – wird wiederholt');
    return sent;
  } finally {
    pushing = false;
  }
}

// ------------------------------------------------------------
// Realtime
// ------------------------------------------------------------

function subscribeRealtime(raumId) {
  if (!client) return;
  if (channel) client.removeChannel(channel);

  channel = client.channel(`faden:${raumId}`);
  for (const table of store.SYNCED_TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `raum_id=eq.${raumId}` },
      (payload) => {
        const row = payload.new ?? payload.old;
        if (!row) return;
        store.applyRemoteRow(table, toLocal(table, row));
      },
    );
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') setStatus('online', statusValue.detail || 'Verbunden');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      // Kein Drama: das Polling unten holt die Aenderungen nach.
      setStatus('ready', 'Verbunden (ohne Live-Update)');
    }
  });
}

// ------------------------------------------------------------
// Nachlauf: Polling, Netzwechsel, App wieder im Vordergrund
// ------------------------------------------------------------

function startPolling() {
  clearInterval(pullTimer);
  pullTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      push().then(() => pull());
    }
  }, PULL_INTERVAL_MS);
}

export function installListeners() {
  window.addEventListener('online', async () => {
    if (!client) await connect();
    else {
      await push();
      await pull();
      const wieder = store.getState().raum;
      setStatus(wieder?.id ? 'online' : 'ready',
        wieder?.id ? `Verbunden · ${wieder.name}` : 'Verbunden – noch kein Sync-Raum');
    }
  });

  window.addEventListener('offline', () => setStatus('offline', 'Offline – Änderungen werden gemerkt'));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && client) {
      push().then(() => pull());
    }
  });

  // Jede lokale Aenderung moeglichst zeitnah hochschieben.
  let pushTimer = null;
  store.subscribe(() => {
    if (!client || !store.outboxSize()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(), 800);
  });
}
