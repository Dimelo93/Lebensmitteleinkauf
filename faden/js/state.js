// Zentraler Zustand der App.
//
// Grundsatz wie bei der Einkaufsliste: alles laeuft zuerst lokal.
// Jede Aenderung landet sofort im Speicher des Geraets und
// zusaetzlich in einer Outbox. Die Sync-Schicht arbeitet die Outbox
// ab, sobald wieder Netz da ist.
//
// Der zweite Grundsatz kommt vom Zweck der App: Erfassen darf keine
// Entscheidung verlangen. addCapture() nimmt rohen Text und legt ihn
// in den Eingang - Titel, Tags und Verlinkung ergeben sich spaeter.

import { uid, nowIso, normalize, todayKey, debounce, isNewer } from './util.js';

const STORAGE_KEY = 'faden.v1';
const MAX_TRAIL = 200;
const MAX_CHAT = 60;

// Mit Supabase abgeglichen wird nur die eine Tabelle. Der Faden
// (Verlauf), der Fokus und der Chat bleiben bewusst auf dem Geraet:
// wo du gerade denkst, geht den Server nichts an.
export const SYNCED_TABLES = ['faden_notizen'];

const DEFAULT_SETTINGS = {
  zeigeFertigeProjekte: false,
};

function emptyState() {
  return {
    version: 1,
    raum: null,            // { id, name, joinCode } - der Sync-Raum
    notizen: [],
    trail: [],             // [{ noteId, at }] - der Faden, juengster zuletzt
    fokus: null,           // { noteId, seit } - ueberlebt das Schliessen der App
    chat: [],              // [{ rolle: 'ich'|'hirn', text, quellen, at }]
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
    // Voller Speicher: Verlauf und Chat kuerzen und nochmal
    // versuchen, statt die App scheitern zu lassen. Notizen werden
    // nie weggeworfen.
    console.warn('Speichern fehlgeschlagen, kuerze Verlauf', err);
    state.trail = state.trail.slice(-20);
    state.chat = state.chat.slice(-10);
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
  linkIndexDirty = true;
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

/**
 * Aenderung fuer den Server vormerken (Upsert der ganzen Zeile).
 *
 * Als Momentaufnahme, nicht als Referenz: applyRemoteRow ersetzt
 * Notiz-Objekte im Array, und eine Outbox voller lebender Verweise
 * wuerde danach stillschweigend etwas anderes hochladen, als beim
 * Einreihen gemeint war.
 */
function enqueue(table, row) {
  if (!state.raum) return;
  const existing = state.outbox.findIndex((entry) => entry.table === table && entry.rowId === row.id);
  const entry = { table, rowId: row.id, row: { ...row }, at: nowIso() };
  if (existing >= 0) state.outbox[existing] = entry;
  else state.outbox.push(entry);
}

export function outboxSize() {
  return state.outbox.length;
}

/**
 * Die Outbox ansehen, ohne sie zu leeren. Geleert wird erst nach
 * bestaetigtem Upload (confirmOutbox) - stirbt die App mitten im
 * Senden, liegt die Vormerkung noch da und geht beim naechsten Mal.
 * Doppeltes Senden ist dank Upsert + Zeitstempel-Waechter harmlos.
 */
export function peekOutbox() {
  return [...state.outbox];
}

/** Erfolgreich gesendete Eintraege austragen. Ein Eintrag, der
 *  waehrend des Uploads neu eingereiht wurde (anderes at), bleibt. */
export function confirmOutbox(batch) {
  const sent = new Set(batch.map((e) => `${e.table}|${e.rowId}|${e.at}`));
  state.outbox = state.outbox.filter((e) => !sent.has(`${e.table}|${e.rowId}|${e.at}`));
  persist();
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
  return state;
}

export function resetAll() {
  state = emptyState();
  notify();
}

// ------------------------------------------------------------
// Sync-Raum
// ------------------------------------------------------------

export function setRaum(raum) {
  state.raum = raum;
  if (raum) {
    // Beim ersten Verbinden alles Lokale hochladen, damit die
    // bereits geschriebenen Notizen nicht verlorengehen.
    for (const note of state.notizen) enqueue('faden_notizen', note);
  }
  notify();
}

// ------------------------------------------------------------
// Notizen
// ------------------------------------------------------------

export const activeNotes = () => state.notizen.filter((n) => !n.deleted);

export function noteById(id) {
  return state.notizen.find((n) => n.id === id && !n.deleted) ?? null;
}

/** Notiz ueber ihren Titel finden - so loesen sich [[Verlinkungen]] auf. */
export function noteByTitle(titel) {
  const key = normalize(titel);
  if (!key) return null;
  return activeNotes().find((n) => normalize(n.titel) === key) ?? null;
}

/** Tags (#wort) aus dem Text ziehen. Wird beim Speichern abgelegt,
 *  damit Suche und Filter nicht bei jedem Tastendruck den ganzen
 *  Bestand durchparsen muessen. */
export function extractTags(text) {
  const tags = new Set();
  // Nur echte Tags: # am Wortanfang, kein Markdown-Titel (# mit
  // Leerzeichen danach) und keine Farbwerte (#fff). Die Wortgrenze
  // und die Zeichenklasse muessen zum Renderer (md.js) passen, sonst
  // zeigt ein Chip auf einen Tag, den die Suche nicht kennt.
  for (const match of String(text || '').matchAll(/(^|[\s(])#([a-zäöüéèA-ZÄÖÜ][\wäöüÄÖÜéè-]*)/g)) {
    tags.add(match[2].toLowerCase());
  }
  return [...tags];
}

/** Alle [[Verlinkungen]] im Text, als Roh-Titel. */
export function extractLinks(text) {
  const links = [];
  for (const match of String(text || '').matchAll(/\[\[([^\[\]\n]+?)\]\]/g)) {
    const titel = match[1].trim();
    if (titel) links.push(titel);
  }
  return links;
}

function baseNote() {
  return {
    id: uid(),
    titel: '',
    text: '',
    typ: 'notiz',        // 'notiz' | 'projekt' | 'journal'
    status: null,        // Projekte: 'offen' | 'fertig'
    naechster: null,     // Projekte: der eine naechste kleine Schritt
    inbox: false,
    tags: [],
    angeheftet: false,
    deleted: false,
    erstellt: nowIso(),
    besucht: null,
    updatedAt: nowIso(),
  };
}

/**
 * Der wichtigste Aufruf der App: rohen Text erfassen, ohne eine
 * einzige Rueckfrage. Erste Zeile wird Titel, der Rest Inhalt,
 * alles landet im Eingang.
 */
export function addCapture(text, { typ = 'notiz' } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const [first, ...rest] = trimmed.split('\n');
  // Tags am Zeilenende gehoeren nicht in den Titel: "Zaehlerstand
  // melden #umzug" soll als [[Zaehlerstand melden]] verlinkbar sein.
  // Erfasst werden die Tags trotzdem (extractTags unten).
  let titel = first.trim()
    .replace(/^#+\s+/, '')
    .replace(/(\s+#[\wäöüÄÖÜéè-]+)+\s*$/, '')
    .trim() || first.trim();
  let body = rest.join('\n').trim();
  // Eine sehr lange erste Zeile ist ein Gedanke, kein Titel - dann
  // bleibt alles im Text und der Titel wird der Anfang davon.
  if (titel.length > 80) {
    titel = `${titel.slice(0, 60).trim()} …`;
    body = trimmed;
  }

  const note = {
    ...baseNote(),
    titel,
    text: body,
    typ,
    status: typ === 'projekt' ? 'offen' : null,
    inbox: typ === 'notiz',
    tags: extractTags(trimmed),
  };
  state.notizen.push(note);
  enqueue('faden_notizen', note);
  notify();
  return note;
}

export function addNote(patch = {}) {
  const note = { ...baseNote(), ...patch, updatedAt: nowIso() };
  note.tags = extractTags(`${note.titel}\n${note.text}`);
  state.notizen.push(note);
  enqueue('faden_notizen', note);
  notify();
  return note;
}

export function updateNote(id, patch) {
  const note = state.notizen.find((n) => n.id === id);
  if (!note) return null;
  Object.assign(note, patch, { updatedAt: nowIso() });
  if (patch.text !== undefined || patch.titel !== undefined) {
    note.tags = extractTags(`${note.titel}\n${note.text}`);
  }
  enqueue('faden_notizen', note);
  notify();
  return note;
}

export function removeNote(id) {
  const note = state.notizen.find((n) => n.id === id);
  if (!note) return;
  note.deleted = true;
  note.updatedAt = nowIso();
  enqueue('faden_notizen', note);
  // Ein geloeschter Halt im Faden waere eine Sackgasse.
  state.trail = state.trail.filter((step) => step.noteId !== id);
  if (state.fokus?.noteId === id) state.fokus = null;
  notify();
}

export function restoreNote(id) {
  const note = state.notizen.find((n) => n.id === id);
  if (!note) return;
  note.deleted = false;
  note.updatedAt = nowIso();
  enqueue('faden_notizen', note);
  notify();
}

/**
 * Die Tagesnotiz: eine Journal-Notiz pro Tag, Titel ist das Datum.
 * Wird beim ersten Zugriff des Tages angelegt - der Anker, an dem
 * der Tag haengt.
 */
export function todayNote() {
  const key = todayKey();
  let note = activeNotes().find((n) => n.typ === 'journal' && n.titel === key);
  if (!note) {
    note = addNote({ titel: key, typ: 'journal', inbox: false });
  }
  return note;
}

/** Eingang: alles, was erfasst, aber noch nicht einsortiert ist. */
export const inboxNotes = () =>
  activeNotes().filter((n) => n.inbox).sort((a, b) => String(a.erstellt).localeCompare(String(b.erstellt)));

export const projects = ({ mitFertigen = false } = {}) =>
  activeNotes()
    .filter((n) => n.typ === 'projekt' && (mitFertigen || n.status !== 'fertig'))
    .sort((a, b) => Number(b.angeheftet) - Number(a.angeheftet) || String(b.updatedAt).localeCompare(String(a.updatedAt)));

/** "Weitermachen": zuletzt besuchte Notizen, ohne die Tagesnotiz von heute. */
export function recentNotes(limit = 5) {
  const today = todayKey();
  return activeNotes()
    .filter((n) => n.besucht && !(n.typ === 'journal' && n.titel === today))
    .sort((a, b) => String(b.besucht).localeCompare(String(a.besucht)))
    .slice(0, limit);
}

/** Heute erfasste Notizen - fuer die Heute-Ansicht. */
export function capturedToday() {
  const today = todayKey();
  return activeNotes()
    .filter((n) => n.erstellt && todayKey(new Date(n.erstellt)) === today && n.typ !== 'journal')
    .sort((a, b) => String(b.erstellt).localeCompare(String(a.erstellt)));
}

// ------------------------------------------------------------
// Verlinkung: wer zeigt auf wen?
// ------------------------------------------------------------

// Der Index wird traege neu gebaut: erst wenn nach einer Aenderung
// wieder jemand Backlinks sehen will. Bei ein paar tausend Notizen
// dauert der Aufbau Millisekunden - Buchhaltung pro Aenderung waere
// komplizierter als das Problem.
let linkIndexDirty = true;
let linkIndex = new Map(); // normalize(titel) -> Set<noteId der verweisenden Notiz>

function buildLinkIndex() {
  linkIndex = new Map();
  for (const note of activeNotes()) {
    for (const titel of extractLinks(note.text)) {
      const key = normalize(titel);
      if (!key) continue;
      if (!linkIndex.has(key)) linkIndex.set(key, new Set());
      linkIndex.get(key).add(note.id);
    }
  }
  linkIndexDirty = false;
}

/** Alle Notizen, die auf diese Notiz verlinken. */
export function backlinks(note) {
  if (linkIndexDirty) buildLinkIndex();
  const ids = linkIndex.get(normalize(note.titel));
  if (!ids) return [];
  return [...ids]
    .filter((id) => id !== note.id)
    .map((id) => noteById(id))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// ------------------------------------------------------------
// Suche
// ------------------------------------------------------------

/**
 * Volltextsuche ueber Titel, Text und Tags. Alle Woerter muessen
 * vorkommen; Titeltreffer wiegen mehr als Texttreffer.
 */
export function searchNotes(query, { limit = 50 } = {}) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return [];

  const hits = [];
  for (const note of activeNotes()) {
    const titel = normalize(note.titel);
    const text = normalize(note.text);
    const tags = note.tags.join(' ');
    let score = 0;
    let ok = true;
    for (const word of words) {
      if (titel.includes(word)) score += 4;
      else if (tags.includes(word)) score += 3;
      else if (text.includes(word)) score += 1;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (note.angeheftet) score += 2;
    hits.push({ note, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || String(b.note.updatedAt).localeCompare(String(a.note.updatedAt)))
    .slice(0, limit)
    .map((h) => h.note);
}

/**
 * Notizen fuer den Chat auswaehlen: was zur Frage passt, dazu das
 * Frischeste. Die Auswahl passiert lokal - hochgeschickt wird nur,
 * was das Modell wirklich braucht.
 */
export function chatContext(frage, { maxNotes = 25, maxCharsPerNote = 2500 } = {}) {
  const words = normalize(frage).split(' ').filter(Boolean);
  const scored = activeNotes().map((note) => {
    const titel = normalize(note.titel);
    const text = normalize(note.text);
    let score = 0;
    for (const word of words) {
      if (word.length < 3) continue;
      if (titel.includes(word)) score += 6;
      if (note.tags.some((t) => normalize(t).includes(word))) score += 4;
      if (text.includes(word)) score += 2;
    }
    if (note.angeheftet) score += 2;
    // Frische zaehlt, entscheidet aber nicht allein.
    const ageDays = (Date.now() - new Date(note.updatedAt).getTime()) / 86400000;
    if (ageDays < 7) score += 1;
    return { note, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxNotes)
    .map(({ note }) => ({
      titel: note.titel,
      typ: note.typ,
      tags: note.tags,
      geaendert: note.updatedAt,
      naechster: note.naechster,
      text: String(note.text || '').slice(0, maxCharsPerNote),
    }));
}

// ------------------------------------------------------------
// Der Faden (Verlauf) und der Fokus
// ------------------------------------------------------------

/** Einen Halt in den Faden knuepfen - beim Oeffnen einer Notiz. */
export function visit(noteId) {
  const note = state.notizen.find((n) => n.id === noteId);
  if (!note) return;
  note.besucht = nowIso();
  // Kein enqueue: "besucht" ist Geraetesache. Zwei Geraete wuerden
  // sich sonst gegenseitig den Verlauf zerschreiben.

  const last = state.trail[state.trail.length - 1];
  if (last?.noteId !== noteId) {
    state.trail.push({ noteId, at: nowIso() });
    state.trail = state.trail.slice(-MAX_TRAIL);
  }
  notify();
}

/** Der vorige Halt - das Ziel der "Zurück zu"-Leiste. */
export function previousStop() {
  for (let i = state.trail.length - 2; i >= 0; i -= 1) {
    const note = noteById(state.trail[i].noteId);
    if (note) return note;
  }
  return null;
}

/** Einen Schritt im Faden zurueckgehen. Gibt die Zielnotiz zurueck. */
export function stepBack() {
  const target = previousStop();
  if (!target) return null;
  state.trail.pop();
  const note = state.notizen.find((n) => n.id === target.id);
  if (note) note.besucht = nowIso();
  notify();
  return target;
}

/** Der Faden von heute, aeltester Halt zuerst. */
export function todayTrail() {
  const today = todayKey();
  return state.trail
    .filter((step) => todayKey(new Date(step.at)) === today)
    .map((step) => ({ ...step, note: noteById(step.noteId) }))
    .filter((step) => step.note);
}

export function startFokus(noteId) {
  state.fokus = { noteId, seit: nowIso() };
  notify();
}

export function endFokus() {
  state.fokus = null;
  notify();
}

export function fokusNote() {
  if (!state.fokus) return null;
  const note = noteById(state.fokus.noteId);
  if (!note) {
    state.fokus = null;
    return null;
  }
  return note;
}

// ------------------------------------------------------------
// Chat (nur lokal)
// ------------------------------------------------------------

export function addChatMessage(message) {
  state.chat.push({ at: nowIso(), ...message });
  state.chat = state.chat.slice(-MAX_CHAT);
  notify();
}

export function clearChat() {
  state.chat = [];
  notify();
}

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
  if (table !== 'faden_notizen' || !row) return false;
  const index = state.notizen.findIndex((n) => n.id === row.id);
  if (index < 0) {
    state.notizen.push(row);
  } else if (isNewer(row.updatedAt, state.notizen[index].updatedAt)) {
    // "besucht" bleibt lokal: der Server kennt den Wert gar nicht,
    // und ein undefined wuerde den hiesigen Verlauf ausloeschen.
    row.besucht = state.notizen[index].besucht;
    state.notizen[index] = row;
  } else {
    return false;
  }

  // Der Server hat fuer diese Zeile gewonnen - eine noch wartende
  // aeltere Fassung in der Outbox wuerde die Entscheidung gleich
  // wieder rueckgaengig machen. Also raus damit.
  state.outbox = state.outbox.filter((e) => !(e.table === table && e.rowId === row.id));

  // Wurde die Notiz auf einem anderen Geraet geloescht, gilt hier
  // dasselbe wie bei removeNote: kein toter Halt im Faden, kein
  // Fokus auf eine Notiz, die es nicht mehr gibt.
  if (row.deleted) {
    state.trail = state.trail.filter((step) => step.noteId !== row.id);
    if (state.fokus?.noteId === row.id) state.fokus = null;
  }

  notify();
  return true;
}

export function markPulled() {
  state.lastPulledAt = nowIso();
  persist();
}
