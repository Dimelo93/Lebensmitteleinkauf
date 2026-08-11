// Zentraler Zustand der App.
//
// Grundsatz: alles laeuft zuerst lokal. Jede Aenderung landet
// sofort im Speicher des Geraets und zusaetzlich in einer Outbox.
// Die Sync-Schicht arbeitet die Outbox ab, sobald wieder Netz da
// ist. Dadurch funktioniert die Liste im Ladenuntergeschoss ohne
// Empfang genauso wie zu Hause.

import { uid, nowIso, memoryKey, isNewer, debounce, colorFor } from './util.js';
import { guessCategory, guessUnit } from './katalog.js';

const STORAGE_KEY = 'lebensmittel.v1';
const MAX_TRIPS = 200;
const MAX_RECEIPTS = 200;

// Diese Tabellen werden mit Supabase abgeglichen. Reihenfolge
// zaehlt: Laeden muessen vor Artikeln ankommen, sonst zeigt ein
// Artikel kurz auf einen Laden, den es noch nicht gibt.
export const SYNCED_TABLES = ['stores', 'items', 'staples', 'item_memory', 'trips', 'receipts'];

const DEFAULT_SETTINGS = {
  groupByCategory: true,
  showPrices: true,
  currency: 'CHF',
  budget: null,
  activeStoreId: null,
  hideDone: false,
};

const STARTER_STORES = ['Lidl', 'Migros', 'Coop', 'Halal Metzger', 'Asia Shop'];

function emptyState() {
  return {
    version: 1,
    household: null,
    deviceName: null,
    stores: [],
    items: [],
    staples: [],
    memory: {},
    trips: [],
    receipts: [],
    settings: { ...DEFAULT_SETTINGS },
    outbox: [],
    lastPulledAt: null,
  };
}

let state = emptyState();
const listeners = new Set();

const persist = debounce(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Voller Speicher: aelteste Verlaufseintraege wegwerfen und
    // nochmal versuchen, statt die App scheitern zu lassen.
    console.warn('Speichern fehlgeschlagen, kuerze Verlauf', err);
    state.trips = state.trips.slice(0, 20);
    state.receipts = state.receipts.slice(0, 20);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* dann eben nur im Arbeitsspeicher */
    }
  }
}, 250);

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let notifyScheduled = false;
function notify() {
  persist();
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (err) {
        console.error('Fehler im View-Update', err);
      }
    }
  });
}

/** Aenderung fuer den Server vormerken (Upsert der ganzen Zeile). */
function enqueue(table, row) {
  if (!state.household) return;
  const existing = state.outbox.findIndex((entry) => entry.table === table && entry.rowId === rowIdOf(table, row));
  const entry = { table, rowId: rowIdOf(table, row), row, at: nowIso() };
  if (existing >= 0) state.outbox[existing] = entry;
  else state.outbox.push(entry);
}

function rowIdOf(table, row) {
  return table === 'item_memory' ? row.key : row.id;
}

export function outboxSize() {
  return state.outbox.length;
}

export function takeOutbox() {
  const batch = state.outbox;
  state.outbox = [];
  persist();
  return batch;
}

export function returnToOutbox(batch) {
  // Nur zurueckstellen, was inzwischen nicht schon neuer ueberschrieben wurde.
  for (const entry of batch) {
    const exists = state.outbox.some((e) => e.table === entry.table && e.rowId === entry.rowId);
    if (!exists) state.outbox.unshift(entry);
  }
  notify();
}

// ------------------------------------------------------------
// Laden / Zuruecksetzen
// ------------------------------------------------------------

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...emptyState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) } };
    }
  } catch (err) {
    console.warn('Gespeicherte Daten unlesbar, starte frisch', err);
    state = emptyState();
  }
  if (!state.stores.some((s) => !s.deleted)) seedStores();
  return state;
}

function seedStores() {
  STARTER_STORES.forEach((name, index) => {
    const store = {
      id: uid(),
      name,
      color: colorFor(name),
      note: null,
      position: index,
      deleted: false,
      updatedAt: nowIso(),
    };
    state.stores.push(store);
    enqueue('stores', store);
  });
}

export function resetAll() {
  state = emptyState();
  seedStores();
  notify();
}

// ------------------------------------------------------------
// Haushalt
// ------------------------------------------------------------

export function setHousehold(household) {
  state.household = household;
  if (household) {
    // Beim ersten Verbinden alles Lokale hochladen, damit die
    // bereits getippte Liste nicht verlorengeht.
    for (const table of SYNCED_TABLES) {
      for (const row of rowsOf(table)) enqueue(table, row);
    }
  }
  notify();
}

export function setDeviceName(name) {
  state.deviceName = name || null;
  notify();
}

function rowsOf(table) {
  if (table === 'item_memory') return Object.values(state.memory);
  return state[table] ?? [];
}

// ------------------------------------------------------------
// Laeden
// ------------------------------------------------------------

export const activeStores = () => state.stores.filter((s) => !s.deleted).sort((a, b) => a.position - b.position);

export function storeById(id) {
  return state.stores.find((s) => s.id === id && !s.deleted) ?? null;
}

export function addStore(name, { color = null, note = null } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = activeStores().find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;

  const store = {
    id: uid(),
    name: trimmed,
    color: color || colorFor(trimmed),
    note,
    position: activeStores().length,
    deleted: false,
    updatedAt: nowIso(),
  };
  state.stores.push(store);
  enqueue('stores', store);
  notify();
  return store;
}

export function updateStore(id, patch) {
  const store = state.stores.find((s) => s.id === id);
  if (!store) return;
  Object.assign(store, patch, { updatedAt: nowIso() });
  enqueue('stores', store);
  notify();
}

export function removeStore(id) {
  const store = state.stores.find((s) => s.id === id);
  if (!store) return;
  store.deleted = true;
  store.updatedAt = nowIso();
  enqueue('stores', store);

  // Artikel des Ladens bleiben bestehen, wandern aber nach
  // "Noch kein Laden" - lieber ein unsortierter Artikel als ein
  // verschwundener.
  for (const item of state.items) {
    if (item.storeId === id && !item.deleted) {
      item.storeId = null;
      item.updatedAt = nowIso();
      enqueue('items', item);
    }
  }
  if (state.settings.activeStoreId === id) state.settings.activeStoreId = null;
  reindexStores();
  notify();
}

export function moveStore(id, direction) {
  const list = activeStores();
  const index = list.findIndex((s) => s.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  list.forEach((store, position) => {
    if (store.position !== position) {
      store.position = position;
      store.updatedAt = nowIso();
      enqueue('stores', store);
    }
  });
  notify();
}

function reindexStores() {
  activeStores().forEach((store, position) => {
    if (store.position !== position) {
      store.position = position;
      store.updatedAt = nowIso();
      enqueue('stores', store);
    }
  });
}

export function setActiveStore(id) {
  state.settings.activeStoreId = state.settings.activeStoreId === id ? null : id;
  notify();
}

// ------------------------------------------------------------
// Artikel-Gedaechtnis
// ------------------------------------------------------------

/** Was weiss die App ueber diesen Artikelnamen? */
export function recall(name) {
  const key = memoryKey(name);
  if (!key) return null;
  const entry = state.memory[key];
  if (!entry) return null;
  // Zeigt der gemerkte Laden ins Leere (geloescht), lieber nichts
  // vorschlagen als auf einen toten Laden verweisen.
  const storeId = entry.storeId && storeById(entry.storeId) ? entry.storeId : null;
  return { ...entry, storeId };
}

export function remember(name, { storeId = null, unit = null, category = null, price = null, countUse = true } = {}) {
  const key = memoryKey(name);
  if (!key) return;
  const prev = state.memory[key];
  const entry = prev
    ? { ...prev }
    : { key, label: name, storeId: null, unit: null, category: null, price: null, prices: {}, uses: 0, lastUsedAt: nowIso() };

  entry.label = name || entry.label;
  if (storeId) entry.storeId = storeId;
  if (unit) entry.unit = unit;
  if (category) entry.category = category;
  if (price != null) entry.price = price;
  if (countUse) entry.uses = (entry.uses || 0) + 1;
  entry.lastUsedAt = nowIso();
  entry.updatedAt = nowIso();

  state.memory[key] = entry;
  enqueue('item_memory', entry);
  notify();
}

/**
 * Bezahlten Preis festhalten - je Laden getrennt, damit der
 * Ladenvergleich in der Quittungs-Analyse echte Zahlen hat statt
 * Schaetzungen.
 */
export function recordPrice(name, { storeId, price, qty = null, unit = null, at = null }) {
  const key = memoryKey(name);
  if (!key || price == null || !Number.isFinite(Number(price))) return;
  const bucket = storeId || 'unbekannt';
  const entry = state.memory[key] ?? {
    key,
    label: name,
    storeId: storeId || null,
    unit: unit || null,
    category: guessCategory(name),
    price: null,
    prices: {},
    uses: 0,
    lastUsedAt: nowIso(),
  };
  entry.prices = entry.prices || {};

  const perStore = entry.prices[bucket] ?? { n: 0, sum: 0, last: null, unit: null, at: null };
  const value = Number(price);
  // Auf Einheitspreis normieren, wo eine Menge bekannt ist -
  // sonst vergleicht man 500 g mit 1 kg.
  const unitPrice = qty && Number(qty) > 0 ? value / Number(qty) : value;

  perStore.n += 1;
  perStore.sum += unitPrice;
  perStore.avg = Math.round((perStore.sum / perStore.n) * 100) / 100;
  perStore.last = Math.round(unitPrice * 100) / 100;
  perStore.unit = unit || perStore.unit;
  perStore.at = at || nowIso();
  entry.prices[bucket] = perStore;

  entry.price = perStore.last;
  entry.label = entry.label || name;
  entry.updatedAt = nowIso();
  state.memory[key] = entry;
  enqueue('item_memory', entry);
  notify();
}

/** Alle Preise zu einem Artikel, nach Laden sortiert (guenstigster zuerst). */
export function priceComparison(name) {
  const entry = recall(name);
  if (!entry?.prices) return [];
  return Object.entries(entry.prices)
    .map(([storeId, stats]) => ({
      storeId: storeId === 'unbekannt' ? null : storeId,
      storeName: storeById(storeId)?.name ?? 'Unbekannt',
      ...stats,
    }))
    .filter((row) => row.last != null)
    .sort((a, b) => a.last - b.last);
}

/** Haeufig gekaufte Artikel, die gerade nicht auf der Liste stehen. */
export function frequentSuggestions(limit = 12) {
  const onList = new Set(state.items.filter((i) => !i.deleted && !i.done).map((i) => memoryKey(i.name)));
  return Object.values(state.memory)
    .filter((entry) => (entry.uses || 0) >= 2 && !onList.has(entry.key))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
    .slice(0, limit);
}

// ------------------------------------------------------------
// Artikel
// ------------------------------------------------------------

export const activeItems = () => state.items.filter((i) => !i.deleted);

export function addItem({ name, qty = null, unit = null, storeId = undefined, price = null, note = null, category = null }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const known = recall(trimmed);
  const resolvedStore = storeId !== undefined ? storeId : known?.storeId ?? null;
  const resolvedCategory = category ?? known?.category ?? guessCategory(trimmed);
  const resolvedUnit = unit ?? known?.unit ?? (qty != null ? guessUnit(trimmed, resolvedCategory) : null);

  // Schon auf der Liste und noch offen? Dann Menge erhoehen
  // statt einer zweiten Zeile "Milch".
  const duplicate = activeItems().find(
    (item) => !item.done && memoryKey(item.name) === memoryKey(trimmed) && item.storeId === resolvedStore,
  );
  if (duplicate) {
    duplicate.qty = (Number(duplicate.qty) || 1) + (Number(qty) || 1);
    duplicate.unit = duplicate.unit ?? resolvedUnit;
    duplicate.updatedAt = nowIso();
    enqueue('items', duplicate);
    remember(trimmed, { storeId: resolvedStore, unit: duplicate.unit, category: resolvedCategory });
    notify();
    return duplicate;
  }

  const item = {
    id: uid(),
    storeId: resolvedStore,
    name: trimmed,
    qty,
    unit: resolvedUnit,
    category: resolvedCategory,
    price: price ?? null,
    note,
    done: false,
    position: activeItems().length,
    deleted: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.items.push(item);
  enqueue('items', item);
  remember(trimmed, { storeId: resolvedStore, unit: resolvedUnit, category: resolvedCategory });
  notify();
  return item;
}

export function updateItem(id, patch) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  const storeChanged = patch.storeId !== undefined && patch.storeId !== item.storeId;
  Object.assign(item, patch, { updatedAt: nowIso() });
  enqueue('items', item);

  // Manuelle Ladenkorrektur ist das staerkste Signal fuers
  // Gedaechtnis - beim naechsten Mal sitzt der Vorschlag.
  if (storeChanged) remember(item.name, { storeId: item.storeId, countUse: false });
  if (patch.unit) remember(item.name, { unit: patch.unit, countUse: false });
  if (patch.category) remember(item.name, { category: patch.category, countUse: false });
  notify();
}

export function toggleItem(id, done = null) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.done = done == null ? !item.done : done;
  item.doneAt = item.done ? nowIso() : null;
  item.updatedAt = nowIso();
  enqueue('items', item);
  notify();
}

export function removeItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.deleted = true;
  item.updatedAt = nowIso();
  enqueue('items', item);
  notify();
}

export function restoreItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.deleted = false;
  item.updatedAt = nowIso();
  enqueue('items', item);
  notify();
}

export function clearDone() {
  for (const item of state.items) {
    if (item.done && !item.deleted) {
      item.deleted = true;
      item.updatedAt = nowIso();
      enqueue('items', item);
    }
  }
  notify();
}

export function moveItem(id, storeId) {
  updateItem(id, { storeId });
}

// ------------------------------------------------------------
// Einkauf abschliessen
// ------------------------------------------------------------

/**
 * Abgehakte Artikel wandern in den Verlauf, ihre Preise ins
 * Gedaechtnis. Offene Artikel bleiben auf der Liste stehen.
 */
export function finishTrip({ storeIds = null } = {}) {
  const done = activeItems().filter((item) => item.done && (!storeIds || storeIds.includes(item.storeId)));
  if (!done.length) return null;

  const byStore = new Map();
  for (const item of done) {
    const key = item.storeId ?? 'null';
    if (!byStore.has(key)) {
      byStore.set(key, { storeId: item.storeId, storeName: storeById(item.storeId)?.name ?? 'Ohne Laden', total: 0, count: 0 });
    }
    const bucket = byStore.get(key);
    bucket.count += 1;
    bucket.total += Number(item.price) || 0;
    if (item.price != null) {
      recordPrice(item.name, { storeId: item.storeId, price: item.price, qty: item.qty, unit: item.unit });
    }
    remember(item.name, { storeId: item.storeId, unit: item.unit, category: item.category, countUse: false });
  }

  const trip = {
    id: uid(),
    finishedAt: nowIso(),
    total: Math.round([...byStore.values()].reduce((sum, b) => sum + b.total, 0) * 100) / 100,
    payload: {
      stores: [...byStore.values()],
      items: done.map((item) => ({
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        price: item.price,
        category: item.category,
        storeId: item.storeId,
        storeName: storeById(item.storeId)?.name ?? null,
      })),
    },
    deleted: false,
    updatedAt: nowIso(),
  };

  state.trips.unshift(trip);
  state.trips = state.trips.slice(0, MAX_TRIPS);
  enqueue('trips', trip);

  for (const item of done) {
    item.deleted = true;
    item.updatedAt = nowIso();
    enqueue('items', item);
  }
  notify();
  return trip;
}

export function deleteTrip(id) {
  const trip = state.trips.find((t) => t.id === id);
  if (!trip) return;
  trip.deleted = true;
  trip.updatedAt = nowIso();
  enqueue('trips', trip);
  notify();
}

export const activeTrips = () => state.trips.filter((t) => !t.deleted);

// ------------------------------------------------------------
// Vorlagen (Wocheneinkauf)
// ------------------------------------------------------------

export const activeStaples = () => state.staples.filter((s) => !s.deleted).sort((a, b) => a.position - b.position);

export function addStaple({ name, qty = null, unit = null, storeId = undefined }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  if (activeStaples().some((s) => memoryKey(s.name) === memoryKey(trimmed))) return null;

  const known = recall(trimmed);
  const staple = {
    id: uid(),
    name: trimmed,
    qty,
    unit: unit ?? known?.unit ?? null,
    category: known?.category ?? guessCategory(trimmed),
    storeId: storeId !== undefined ? storeId : known?.storeId ?? null,
    position: activeStaples().length,
    deleted: false,
    updatedAt: nowIso(),
  };
  state.staples.push(staple);
  enqueue('staples', staple);
  notify();
  return staple;
}

export function updateStaple(id, patch) {
  const staple = state.staples.find((s) => s.id === id);
  if (!staple) return;
  Object.assign(staple, patch, { updatedAt: nowIso() });
  enqueue('staples', staple);
  notify();
}

export function removeStaple(id) {
  const staple = state.staples.find((s) => s.id === id);
  if (!staple) return;
  staple.deleted = true;
  staple.updatedAt = nowIso();
  enqueue('staples', staple);
  notify();
}

export function addStaplesToList(ids) {
  const wanted = new Set(ids);
  let added = 0;
  for (const staple of activeStaples()) {
    if (!wanted.has(staple.id)) continue;
    const before = activeItems().length;
    addItem({ name: staple.name, qty: staple.qty, unit: staple.unit, storeId: staple.storeId, category: staple.category });
    if (activeItems().length > before) added += 1;
  }
  return added;
}

// ------------------------------------------------------------
// Quittungen
// ------------------------------------------------------------

export function addReceipt(receipt) {
  const row = {
    id: receipt.id ?? uid(),
    storeId: receipt.storeId ?? null,
    storeName: receipt.storeName ?? null,
    purchasedAt: receipt.purchasedAt ?? nowIso(),
    total: receipt.total ?? null,
    payload: receipt.payload ?? {},
    deleted: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.receipts.unshift(row);
  state.receipts = state.receipts.slice(0, MAX_RECEIPTS);
  enqueue('receipts', row);

  // Erkannte Preise ins Gedaechtnis - damit wird der naechste
  // Ladenvergleich genauer, ohne dass jemand etwas eintippt.
  for (const line of row.payload?.items ?? []) {
    if (line.price == null || !line.name) continue;
    recordPrice(line.name, {
      storeId: row.storeId,
      price: line.price,
      qty: line.qty,
      unit: line.unit,
      at: row.purchasedAt,
    });
  }
  notify();
  return row;
}

export function updateReceipt(id, patch) {
  const receipt = state.receipts.find((r) => r.id === id);
  if (!receipt) return;
  Object.assign(receipt, patch, { updatedAt: nowIso() });
  enqueue('receipts', receipt);
  notify();
}

export function deleteReceipt(id) {
  const receipt = state.receipts.find((r) => r.id === id);
  if (!receipt) return;
  receipt.deleted = true;
  receipt.updatedAt = nowIso();
  enqueue('receipts', receipt);
  notify();
}

export const activeReceipts = () => state.receipts.filter((r) => !r.deleted);

// ------------------------------------------------------------
// Einstellungen
// ------------------------------------------------------------

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  notify();
}

// ------------------------------------------------------------
// Eingehende Server-Daten
// ------------------------------------------------------------

/**
 * Uebernimmt eine Zeile vom Server, wenn sie neuer ist als die
 * lokale (Last-Write-Wins auf Zeilenebene). Gibt zurueck, ob sich
 * etwas geaendert hat.
 */
export function applyRemoteRow(table, row) {
  if (!row) return false;
  let changed = false;

  if (table === 'item_memory') {
    const local = state.memory[row.key];
    if (!local || isNewer(row.updatedAt, local.updatedAt)) {
      state.memory[row.key] = row;
      changed = true;
    }
  } else {
    const list = state[table];
    if (!Array.isArray(list)) return false;
    const index = list.findIndex((entry) => entry.id === row.id);
    if (index < 0) {
      list.push(row);
      changed = true;
    } else if (isNewer(row.updatedAt, list[index].updatedAt)) {
      list[index] = row;
      changed = true;
    }
  }

  if (changed) {
    if (table === 'trips') state.trips.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    if (table === 'receipts') state.receipts.sort((a, b) => String(b.purchasedAt).localeCompare(String(a.purchasedAt)));
    notify();
  }
  return changed;
}

export function markPulled() {
  state.lastPulledAt = nowIso();
  persist();
}

// ------------------------------------------------------------
// Auswertungen fuer die Oberflaeche
// ------------------------------------------------------------

/** Die Liste, gruppiert nach Laden in der eingestellten Reihenfolge. */
export function groupedList() {
  const items = activeItems();
  const stores = activeStores();
  const active = state.settings.activeStoreId;

  const groups = stores.map((store) => ({
    store,
    items: items.filter((item) => item.storeId === store.id),
  }));

  const orphans = items.filter((item) => !item.storeId || !stores.some((s) => s.id === item.storeId));
  if (orphans.length) {
    groups.push({ store: { id: null, name: 'Noch kein Laden', color: '#8a8f98', position: 999 }, items: orphans });
  }

  // Der Laden, in dem man gerade steht, gehoert nach oben.
  if (active) {
    const index = groups.findIndex((g) => g.store.id === active);
    if (index > 0) groups.unshift(groups.splice(index, 1)[0]);
  }

  return groups.map((group) => ({
    ...group,
    open: group.items.filter((i) => !i.done),
    done: group.items.filter((i) => i.done),
    total: group.items.reduce((sum, i) => sum + (Number(i.price) || 0), 0),
  }));
}

export function totals() {
  const items = activeItems();
  const sum = (list) => Math.round(list.reduce((acc, i) => acc + (Number(i.price) || 0), 0) * 100) / 100;
  return {
    open: items.filter((i) => !i.done).length,
    done: items.filter((i) => i.done).length,
    total: sum(items),
    doneTotal: sum(items.filter((i) => i.done)),
  };
}

/** Monatssummen aus Einkaeufen und Quittungen - Grundlage fuers Budget. */
export function monthlySpending(monthsBack = 6) {
  const buckets = new Map();
  const add = (iso, amount, source) => {
    if (!iso || !amount) return;
    const key = String(iso).slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, { month: key, total: 0, trips: 0, receipts: 0 });
    const bucket = buckets.get(key);
    bucket.total = Math.round((bucket.total + Number(amount)) * 100) / 100;
    bucket[source] += 1;
  };

  for (const trip of activeTrips()) add(trip.finishedAt, trip.total, 'trips');
  for (const receipt of activeReceipts()) add(receipt.purchasedAt, receipt.total, 'receipts');

  return [...buckets.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, monthsBack);
}

/**
 * Kompakter Auszug der eigenen Preishistorie fuer die
 * Quittungs-Analyse. Nur was wirklich bekannt ist - erfundene
 * Vergleichspreise waeren schlimmer als gar keine.
 */
export function priceContext(limit = 120) {
  const stores = Object.fromEntries(activeStores().map((s) => [s.id, s.name]));
  const out = [];
  for (const entry of Object.values(state.memory)) {
    const prices = entry.prices ?? {};
    const perStore = Object.entries(prices)
      .map(([storeId, stats]) => ({ laden: stores[storeId] ?? 'Unbekannt', letzter_preis: stats.last, schnitt: stats.avg, einheit: stats.unit }))
      .filter((row) => row.letzter_preis != null);
    if (!perStore.length) continue;
    out.push({ artikel: entry.label, einheit: entry.unit, preise: perStore });
  }
  return out.sort((a, b) => b.preise.length - a.preise.length).slice(0, limit);
}
