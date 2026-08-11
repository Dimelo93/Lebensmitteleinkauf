// Abgleich mit Supabase.
//
// Ablauf: anonym anmelden (kein Passwort, das Konto haengt am
// Geraet) -> Haushalt anlegen oder per Code beitreten -> alles
// einmal ziehen -> Outbox hochschieben -> auf Realtime-Ereignisse
// hoeren. Faellt irgendetwas davon aus, laeuft die App lokal
// weiter und holt den Rueckstand beim naechsten Mal nach.

import { getConfig } from '../config.js';
import * as store from './state.js';
import { nowIso } from './util.js';

const CDN_URLS = [
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

/**
 * Selbstauskunft fuer die Einstellungen.
 *
 * Aus der Ferne laesst sich nicht sehen, welche Fassung auf einem
 * Telefon laeuft, woher die Zugangsdaten stammen und woran die
 * Anmeldung scheitert. Ohne diese Angaben raet man - deshalb fragt
 * die App sich selbst und schreibt es hin.
 */
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
    const sb = client ?? null;
    if (!sb) {
      report.sitzung = 'keine Verbindung';
    } else {
      const { data } = await sb.auth.getSession();
      report.sitzung = data?.session ? 'angemeldet' : 'nicht angemeldet';
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
// (etwa doneAt) in Postgres und laesst den Upsert scheitern.

const COLUMNS = {
  stores: { id: 'id', name: 'name', color: 'color', note: 'note', position: 'position', deleted: 'deleted', updatedAt: 'updated_at' },
  items: {
    id: 'id', storeId: 'store_id', name: 'name', qty: 'qty', unit: 'unit', category: 'category',
    price: 'price', note: 'note', done: 'done', position: 'position', deleted: 'deleted',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  staples: {
    id: 'id', storeId: 'store_id', name: 'name', qty: 'qty', unit: 'unit', category: 'category',
    position: 'position', deleted: 'deleted', updatedAt: 'updated_at',
  },
  item_memory: {
    key: 'key', label: 'label', storeId: 'store_id', unit: 'unit', category: 'category',
    price: 'price', prices: 'prices', uses: 'uses', lastUsedAt: 'last_used_at', updatedAt: 'updated_at',
  },
  trips: { id: 'id', finishedAt: 'finished_at', total: 'total', payload: 'payload', deleted: 'deleted', updatedAt: 'updated_at' },
  receipts: {
    id: 'id', storeId: 'store_id', storeName: 'store_name', purchasedAt: 'purchased_at', total: 'total',
    payload: 'payload', deleted: 'deleted', createdAt: 'created_at', updatedAt: 'updated_at',
  },
};

const CONFLICT_TARGET = { item_memory: 'household_id,key' };

function toRemote(table, row, householdId) {
  const map = COLUMNS[table];
  const out = { household_id: householdId };
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
  // numeric kommt aus PostgREST als String zurueck
  for (const key of ['qty', 'price', 'total']) {
    if (out[key] != null && out[key] !== '') out[key] = Number(out[key]);
  }
  return out;
}

// ------------------------------------------------------------
// Client aufbauen
// ------------------------------------------------------------

async function loadLibrary() {
  let lastError = null;
  for (const url of CDN_URLS) {
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

    // Bewusst erst in eine lokale Variable. Eine Verbindung ohne
    // Anmeldung ist schlimmer als gar keine: sie sieht brauchbar
    // aus, hat aber kein Token. Jeder spaetere Aufruf laeuft dann
    // durch bis zur Datenbank, die mit "Nicht angemeldet" antwortet
    // - und der echte Grund bleibt unsichtbar.
    const sb = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lebensmittel.auth' },
      realtime: { params: { eventsPerSecond: 5 } },
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

    const household = store.getState().household;
    if (household?.id) {
      await afterHousehold(household);
    } else {
      // Vielleicht ist dieses Geraet schon Mitglied - dann den
      // Haushalt uebernehmen, statt einen zweiten anzulegen.
      const { data } = await client.rpc('my_households');
      if (data?.length) {
        const found = { id: data[0].id, name: data[0].name, joinCode: data[0].join_code };
        store.setHousehold(found);
        await afterHousehold(found);
      } else {
        setStatus('ready', 'Verbunden – noch kein Haushalt');
      }
    }
    return client;
  } catch (err) {
    // Zuruecksetzen, damit der naechste Versuch wirklich neu
    // aufbaut. Sonst bleibt eine kaputte Verbindung liegen und die
    // App erholt sich auch dann nicht, wenn der Schalter in
    // Supabase inzwischen umgelegt wurde.
    client = null;
    console.warn('Verbindung fehlgeschlagen', err);
    setStatus('error', err.message || 'Verbindung fehlgeschlagen');
    return null;
  }
}

/**
 * Aus der Meldung von Supabase eine machen, mit der man etwas
 * anfangen kann. "Anonymous sign-ins are disabled" sagt einem
 * niemandem, wo der Schalter sitzt.
 */
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

/** Zugriffstoken des angemeldeten Geraets - die Quittungs-Analyse
 *  weist sich damit bei der Edge Function aus. */
export async function accessToken() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session?.access_token ?? null;
}

export async function requireClient() {
  if (client) return client;
  return connect();
}

/** Warum es gerade nicht geht - in den Worten des letzten Versuchs. */
function verbindungsGrund() {
  return statusValue.state === 'error' && statusValue.detail
    ? statusValue.detail
    : 'Keine Verbindung zu Supabase';
}

// ------------------------------------------------------------
// Haushalt
// ------------------------------------------------------------

export async function createHousehold(name, memberName = null) {
  const sb = await requireClient();
  if (!sb) throw new Error(verbindungsGrund());
  const { data, error } = await sb.rpc('create_household', { household_name: name || 'Haushalt', member_name: memberName });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const household = { id: row.id, name: row.name, joinCode: row.join_code };
  store.setHousehold(household);
  await afterHousehold(household);
  return household;
}

export async function joinHousehold(code, memberName = null) {
  const sb = await requireClient();
  if (!sb) throw new Error(verbindungsGrund());
  const { data, error } = await sb.rpc('join_household', { code, member_name: memberName });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const household = { id: row.id, name: row.name, joinCode: row.join_code };
  store.setHousehold(household);
  await afterHousehold(household);
  return household;
}

export async function leaveHousehold() {
  if (client) {
    await client.removeChannel(channel).catch(() => {});
    channel = null;
  }
  store.setHousehold(null);
  setStatus('local', 'Nur auf diesem Gerät');
}

async function afterHousehold(household) {
  await pull();
  await push();
  subscribeRealtime(household.id);
  startPolling();
  setStatus('online', `Verbunden · ${household.name}`);
}

// ------------------------------------------------------------
// Ziehen und Schieben
// ------------------------------------------------------------

export async function pull() {
  const household = store.getState().household;
  if (!client || !household?.id) return 0;

  let count = 0;
  for (const table of store.SYNCED_TABLES) {
    const { data, error } = await client.from(table).select('*').eq('household_id', household.id);
    if (error) {
      console.warn(`Konnte ${table} nicht laden`, error.message);
      continue;
    }
    for (const row of data ?? []) {
      if (store.applyRemoteRow(table, toLocal(table, row))) count += 1;
    }
  }
  store.markPulled();
  // Erst jetzt, mit dem vollstaendigen Bild aus der Datenbank:
  // gleichnamige Laeden von verschiedenen Geraeten zusammenlegen.
  store.mergeDuplicateStores();
  return count;
}

export async function push() {
  const household = store.getState().household;
  if (!client || !household?.id || pushing) return 0;
  if (!store.outboxSize()) return 0;

  pushing = true;
  const batch = store.takeOutbox();
  try {
    // Nach Tabelle buendeln, damit aus 30 Artikeln ein Request wird.
    const byTable = new Map();
    for (const entry of batch) {
      if (!byTable.has(entry.table)) byTable.set(entry.table, []);
      byTable.get(entry.table).push(entry);
    }

    for (const table of store.SYNCED_TABLES) {
      const entries = byTable.get(table);
      if (!entries?.length) continue;
      const rows = entries.map((entry) => toRemote(table, entry.row, household.id));
      const options = CONFLICT_TARGET[table] ? { onConflict: CONFLICT_TARGET[table] } : undefined;
      const { error } = await client.from(table).upsert(rows, options);
      if (error) {
        console.warn(`Konnte ${table} nicht senden`, error.message);
        store.returnToOutbox(entries);
      }
    }
    setStatus(statusValue.state === 'online' ? 'online' : 'ready', statusValue.detail);
    return batch.length;
  } catch (err) {
    console.warn('Senden fehlgeschlagen', err);
    store.returnToOutbox(batch);
    setStatus('error', 'Senden fehlgeschlagen – wird wiederholt');
    return 0;
  } finally {
    pushing = false;
  }
}

// ------------------------------------------------------------
// Realtime
// ------------------------------------------------------------

function subscribeRealtime(householdId) {
  if (!client) return;
  if (channel) client.removeChannel(channel);

  channel = client.channel(`haushalt:${householdId}`);
  for (const table of store.SYNCED_TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
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
      setStatus('online', statusValue.detail || 'Verbunden');
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
