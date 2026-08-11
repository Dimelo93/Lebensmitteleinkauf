// Kleine Helfer, die sonst ueberall doppelt herumliegen wuerden.

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

const UMLAUTE = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', é: 'e', è: 'e', ê: 'e', à: 'a', â: 'a', ô: 'o', î: 'i', ç: 'c' };

/**
 * Normalisiert einen Artikelnamen fuer das Gedaechtnis und die
 * Kategorieerkennung: "Rüebli " und "rueebli" landen auf demselben
 * Schluessel, damit die App den Laden wiedererkennt.
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

/** Sehr grobe Singularform, damit "Tomaten" und "Tomate" zusammenfallen. */
export function stem(word) {
  let w = word;
  for (const suffix of ['nnen', 'chen', 'lein', 'en', 'er', 'el', 'n', 's', 'e']) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

export function memoryKey(name) {
  return normalize(name).split(' ').filter(Boolean).map(stem).join(' ');
}

export function formatMoney(value, currency = 'CHF') {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '';
  return `${currency} ${Number(value).toFixed(2)}`;
}

/** 1.0 -> "1", 0.5 -> "0.5", 1.25 -> "1.25" */
export function formatQty(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  return String(Math.round(n * 1000) / 1000);
}

export function formatAmount(qty, unit) {
  const q = formatQty(qty);
  if (!q && !unit) return '';
  if (!unit) return q;
  if (!q) return unit;
  return unit === 'x' ? `${q}×` : `${q} ${unit}`;
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

/** Stabile Farbe aus einem Namen, damit neue Laeden nicht alle gleich aussehen. */
const PALETTE = ['#e4572e', '#2e86ab', '#38a169', '#8e44ad', '#d99a00', '#0d9488', '#c2185b', '#5c6bc0'];
export function colorFor(text) {
  let hash = 0;
  for (const ch of String(text)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function sortBy(list, ...keys) {
  return [...list].sort((a, b) => {
    for (const key of keys) {
      const [get, dir] = typeof key === 'function' ? [key, 1] : [(x) => x[key], 1];
      const av = get(a);
      const bv = get(b);
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : 1) * dir;
    }
    return 0;
  });
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
