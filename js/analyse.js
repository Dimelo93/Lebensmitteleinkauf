// Quittungsfoto vorbereiten und analysieren lassen.
//
// Das Bild wird vor dem Hochladen verkleinert: eine Handykamera liefert
// gern 4 MB, gebraucht werden davon vielleicht 400 kB. Das spart
// Upload-Zeit im mobilen Netz und Kosten bei der Analyse.

import { getConfig } from '../config.js';
import * as store from './state.js';
import * as sync from './sync.js';

const MAX_EDGE = 2000;   // längste Kante in Pixeln - genug für Kassenzettel-Schrift
const QUALITY = 0.82;

/**
 * Skaliert und komprimiert ein Bild aus der Kamera oder Galerie.
 * @returns {Promise<{media_type: string, data: string, preview: string}>}
 */
export async function prepareImage(file) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  return {
    media_type: 'image/jpeg',
    data: dataUrl.split(',')[1],
    preview: dataUrl,
    width,
    height,
  };
}

function loadBitmap(file) {
  if (globalThis.createImageBitmap) {
    // Respektiert die EXIF-Ausrichtung - sonst liegen Fotos quer.
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht gelesen werden'));
    };
    img.src = url;
  });
}

/**
 * Schickt die Bilder an die Edge Function und gibt die Auswertung zurück.
 * Der eigene Preisverlauf wird mitgeschickt, damit die Vorschläge auf
 * echten Zahlen beruhen statt auf Schätzungen.
 */
export async function analyse({ images, laden = null, zielProzent = 30, notiz = null }) {
  const config = getConfig();
  if (!config.analyseUrl) {
    throw new Error('Für die Quittungs-Analyse fehlt die Verbindung zu Supabase. Siehe Einstellungen.');
  }

  const token = await sync.accessToken();
  if (!token) {
    throw new Error('Nicht angemeldet. Erst unter Einstellungen mit dem Haushalt verbinden.');
  }

  const state = store.getState();
  const payload = {
    images: images.map((image) => ({ media_type: image.media_type, data: image.data })),
    laden,
    notiz,
    zielProzent,
    laeden: store.activeStores().map((s) => s.name),
    preishistorie: store.priceContext(120),
    monatsbudget: state.settings.budget || null,
  };

  const response = await fetch(config.analyseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: config.anonKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Unerwartete Antwort (${response.status}). Läuft die Edge Function?`);
  }

  if (!response.ok) {
    throw new Error(body?.fehler || `Analyse fehlgeschlagen (${response.status})`);
  }
  return body;
}

/**
 * Übernimmt das Analyseergebnis in den Verlauf. Die erkannten Preise
 * wandern dabei automatisch ins Artikel-Gedächtnis (siehe state.js).
 */
export function saveResult(ergebnis, { storeId = null, previews = [] } = {}) {
  const laden = storeId ? store.storeById(storeId) : null;
  return store.addReceipt({
    storeId: laden?.id ?? null,
    storeName: laden?.name ?? ergebnis.laden ?? null,
    purchasedAt: normalizeDate(ergebnis.datum),
    total: ergebnis.summe ?? null,
    payload: {
      items: (ergebnis.positionen ?? []).map((line) => ({
        name: line.name,
        qty: line.menge,
        unit: line.einheit,
        price: line.preis,
        unitPrice: line.einzelpreis,
        category: line.kategorie,
        uncertain: line.unsicher,
      })),
      auffaelligkeiten: ergebnis.auffaelligkeiten ?? [],
      alternativen: ergebnis.alternativen ?? [],
      sparplan: ergebnis.sparplan ?? null,
      hinweise: ergebnis.hinweise ?? [],
      // Nur eine kleine Vorschau speichern - das Originalfoto würde den
      // lokalen Speicher sprengen.
      thumbnails: previews.slice(0, 2),
    },
  });
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/** Kleines Vorschaubild fürs Archiv (Originalfoto wird nicht gespeichert). */
export async function thumbnail(dataUrl, size = 320) {
  const img = await new Promise((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = reject;
    node.src = dataUrl;
  });
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}
