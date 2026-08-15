// Kleine Helfer, die sonst ueberall doppelt herumliegen wuerden.
// Uebernommen aus der Einkaufsliste (js/util.js), gekuerzt um alles
// Laden-Spezifische.

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback fuer aeltere WebViews: UUIDv4 aus getRandomValues.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

export const nowIso = () => new Date().toISOString();

/** Heutiges Datum als JJJJ-MM-TT, in lokaler Zeit - das ist der Titel der Tagesnotiz. */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const UMLAUTE = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', é: 'e', è: 'e', ê: 'e', à: 'a', â: 'a', ô: 'o', î: 'i', ç: 'c' };

/**
 * Normalisiert Text fuer Vergleiche: "Rüebli " und "rueebli" landen
 * auf demselben Schluessel. Darauf beruht die Aufloesung von
 * [[Verlinkungen]] und die Suche.
 */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[äöüßéèêàâôîç]/g, (c) => UMLAUTE[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function relativeDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return `heute, ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "seit 12 min" fuer den Fokus-Modus - bewusst grob, keine Sekunden. */
export function elapsedLabel(iso) {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return '';
  const min = Math.max(0, Math.round((Date.now() - start) / 60000));
  if (min < 1) return 'gerade begonnen';
  if (min < 60) return `seit ${min} min`;
  const h = Math.floor(min / 60);
  return `seit ${h} h ${min % 60} min`;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = () => {
    clearTimeout(t);
    fn();
  };
  return wrapped;
}

/** Kompakter DOM-Bauer: el('div.card', {onclick}, 'Text', kindEl) */
export function el(spec, props, ...children) {
  const [tagPart, ...classes] = String(spec).split('.');
  const node = document.createElement(tagPart || 'div');
  if (classes.length) node.className = classes.join(' ');

  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = [node.className, value].filter(Boolean).join(' ');
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Kinder anhaengen und dabei null/false/'' verwerfen.
 *
 * Das native node.append(null) schreibt die Zeichenkette "null" in die
 * Seite - genau die Falle, in die bedingte Ausdruecke wie
 * `bedingung ? el(...) : null` laufen. Deshalb geht in dieser App jedes
 * Anhaengen durch diese Funktion.
 */
export function add(parent, ...children) {
  for (const child of children.flat(4)) {
    if (child == null || child === false || child === '') continue;
    parent.append(child instanceof Node ? child : String(child));
  }
  return parent;
}

/** Fuer die Konfliktloesung: gewinnt der neuere Zeitstempel? */
export function isNewer(a, b) {
  return new Date(a || 0).getTime() > new Date(b || 0).getTime();
}

export function haptic(pattern = 8) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Safari auf iOS kennt vibrate nicht - egal */
  }
}
