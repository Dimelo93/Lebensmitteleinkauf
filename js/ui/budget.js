// Budget: Quittung fotografieren, auswerten lassen, Verlauf ansehen.

import { add, el, formatMoney, relativeDate } from '../util.js';
import { categoryIcon } from '../katalog.js';
import * as store from '../state.js';
import * as analyse from '../analyse.js';
import { toast, sheet, confirmSheet, emptyState, field } from './shell.js';

// Zustand der laufenden Analyse (überlebt das Neuzeichnen).
let pending = null;   // { images: [], previews: [], storeId, ziel }
let busy = false;
let lastResult = null;
let lastError = null;

let rerenderHook = () => {};
export function setRerender(fn) {
  rerenderHook = fn;
}

export const title = () => 'Budget';

export function subtitle() {
  const months = store.monthlySpending(1);
  const currency = store.getState().settings.currency;
  if (!months.length) return 'Noch keine Ausgaben erfasst';
  return `Diesen Monat ${formatMoney(months[0].total, currency)}`;
}

export function render() {
  const wrap = el('div');
  const settings = store.getState().settings;

  add(wrap, captureCard());

  if (busy) add(wrap, busyCard());
  else if (lastError) add(wrap, errorCard());
  else if (lastResult) add(wrap, resultCard(lastResult, settings));
  else if (pending) add(wrap, pendingCard(settings));

  add(wrap, monthsCard(settings), historyCard(settings));
  return wrap;
}

// ------------------------------------------------------------
// Foto aufnehmen
// ------------------------------------------------------------

function captureCard() {
  const input = el('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    style: { display: 'none' },
    onchange: async (event) => {
      const files = [...(event.target.files ?? [])].slice(0, 5);
      event.target.value = '';
      if (!files.length) return;

      busy = true;
      lastError = null;
      lastResult = null;
      rerenderHook();

      try {
        const images = [];
        for (const file of files) images.push(await analyse.prepareImage(file));
        pending = {
          images,
          previews: images.map((i) => i.preview),
          storeId: guessStore(),
          ziel: 30,
        };
      } catch (err) {
        lastError = err.message || 'Foto konnte nicht gelesen werden';
      } finally {
        busy = false;
        rerenderHook();
      }
    },
  });

  return el('div.card.card-pad',
    el('div.bold', { style: { marginBottom: '4px' } }, 'Quittung auswerten'),
    el('div.small.muted', { style: { marginBottom: '12px' } },
      'Foto vom Kassenzettel machen. Die Analyse liest die Positionen, vergleicht sie mit deinen bisher bezahlten Preisen und rechnet einen Sparplan.'),
    input,
    el('button.btn.primary.block', { onclick: () => input.click() }, '📷 Quittung fotografieren'),
  );
}

function guessStore() {
  // Der zuletzt als aktiv markierte Laden ist die beste Vermutung.
  const active = store.getState().settings.activeStoreId;
  if (active) return active;
  const last = store.activeReceipts()[0];
  return last?.storeId ?? null;
}

function busyCard() {
  return el('div.card.card-pad.center',
    el('div.spinner'),
    el('div.small.muted', { style: { marginTop: '10px' } },
      'Quittung wird gelesen. Bei einem langen Kassenzettel dauert das eine halbe bis eine Minute.'),
  );
}

function errorCard() {
  return el('div.card.card-pad',
    el('div.bold', { style: { color: 'var(--danger)' } }, 'Analyse fehlgeschlagen'),
    el('div.small.muted', { style: { margin: '6px 0 12px' } }, lastError),
    el('button.btn.block', {
      onclick: () => {
        lastError = null;
        rerenderHook();
      },
    }, 'Verstanden'),
  );
}

// ------------------------------------------------------------
// Vor der Analyse: Laden und Sparziel bestätigen
// ------------------------------------------------------------

function pendingCard(settings) {
  const card = el('div.card.card-pad');

  for (const preview of pending.previews.slice(0, 2)) {
    add(card, el('img.shot', { src: preview, alt: 'Quittung' }));
  }
  if (pending.previews.length > 2) {
    add(card, el('div.small.muted', { style: { marginBottom: '10px' } }, `+ ${pending.previews.length - 2} weitere Seiten`));
  }

  const storeSelect = el('select',
    el('option', { value: '', selected: !pending.storeId }, 'Laden erkennt die Analyse selbst'),
    ...store.activeStores().map((laden) =>
      el('option', { value: laden.id, selected: laden.id === pending.storeId }, laden.name)),
  );
  storeSelect.addEventListener('change', () => {
    pending.storeId = storeSelect.value || null;
  });

  const zielInput = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: '5',
    max: '60',
    step: '5',
    value: String(pending.ziel),
  });
  zielInput.addEventListener('change', () => {
    pending.ziel = Math.min(60, Math.max(5, Number(zielInput.value) || 30));
  });

  const notiz = el('input', { type: 'text', placeholder: 'z. B. Wocheneinkauf für 4 Personen' });

  add(card, 
    field('Laden', storeSelect),
    field('Sparziel in Prozent', zielInput),
    field('Notiz (optional)', notiz),
    el('div.btn-row',
      el('button.btn', {
        onclick: () => {
          pending = null;
          rerenderHook();
        },
      }, 'Verwerfen'),
      el('button.btn.primary', {
        onclick: () => runAnalysis(notiz.value.trim() || null),
      }, 'Analysieren'),
    ),
  );

  return card;
}

async function runAnalysis(notiz) {
  if (!pending) return;
  busy = true;
  lastError = null;
  rerenderHook();

  const laden = pending.storeId ? store.storeById(pending.storeId) : null;
  try {
    const { ergebnis } = await analyse.analyse({
      images: pending.images,
      laden: laden?.name ?? null,
      zielProzent: pending.ziel,
      notiz,
    });

    const thumbs = [];
    for (const preview of pending.previews.slice(0, 2)) {
      thumbs.push(await analyse.thumbnail(preview));
    }

    const saved = analyse.saveResult(ergebnis, { storeId: pending.storeId, previews: thumbs });
    lastResult = { ergebnis, receiptId: saved.id };
    pending = null;
    toast('Quittung ausgewertet und gespeichert');
  } catch (err) {
    lastError = err.message || 'Unbekannter Fehler';
  } finally {
    busy = false;
    rerenderHook();
  }
}

// ------------------------------------------------------------
// Ergebnis
// ------------------------------------------------------------

function resultCard({ ergebnis }, settings) {
  const currency = ergebnis.waehrung || settings.currency;
  const wrap = el('div');

  const plan = ergebnis.sparplan ?? {};
  const ziel = Number(plan.ziel_prozent) || 30;
  const real = Number(plan.erreichbar_prozent) || 0;
  const reached = real >= ziel;

  add(wrap, 
    el('div.card.card-pad',
      el('div.small.muted', ergebnis.laden ? `${ergebnis.laden}${ergebnis.datum ? ` · ${ergebnis.datum}` : ''}` : 'Quittung'),
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', margin: '4px 0 2px' } },
        el('div.sum', { style: { fontSize: '26px', fontWeight: '700' } }, formatMoney(ergebnis.summe, currency)),
        plan.summe_neu != null
          ? el('div.small.muted', '→ ', el('span.bold', { style: { color: 'var(--accent)' } }, formatMoney(plan.summe_neu, currency)))
          : null,
      ),
      el('div.bar', el('span', { style: { width: `${Math.min(100, Math.round((real / Math.max(ziel, 1)) * 100))}%` } })),
      el('div.small', { style: { color: reached ? 'var(--accent)' : 'var(--warn)' } },
        reached
          ? `Ziel von ${ziel} % erreichbar: ${real} % gefunden`
          : `Ziel ${ziel} % · realistisch gefunden: ${real} %`),
      plan.fazit ? el('p.small.muted', { style: { marginBottom: 0 } }, plan.fazit) : null,
    ),
  );

  if (plan.massnahmen?.length) {
    const card = el('div.card');
    add(card, el('div.store-head', el('div.grow', el('div.name', 'Sparplan'))));
    for (const step of plan.massnahmen) {
      add(card, 
        el('div.finding',
          step.ersparnis != null ? el('span.amount', '−', formatMoney(step.ersparnis, currency)) : null,
          el('div.t', step.titel, step.aufwand ? el('span.tag', step.aufwand) : null),
          el('div.small.muted', step.beschreibung),
        ),
      );
    }
    add(wrap, card);
  }

  if (ergebnis.auffaelligkeiten?.length) {
    const card = el('div.card');
    add(card, el('div.store-head', el('div.grow', el('div.name', 'Wo das Geld hinging'))));
    for (const finding of ergebnis.auffaelligkeiten) {
      add(card, 
        el('div.finding',
          finding.betrag != null ? el('span.amount', { style: { color: 'var(--text)' } }, formatMoney(finding.betrag, currency)) : null,
          el('div.t', finding.titel),
          el('div.small.muted', finding.begruendung),
        ),
      );
    }
    add(wrap, card);
  }

  if (ergebnis.alternativen?.length) {
    const card = el('div.card');
    add(card, el('div.store-head', el('div.grow', el('div.name', 'Günstigere Alternativen'))));
    for (const alt of ergebnis.alternativen) {
      add(card, 
        el('div.finding',
          alt.ersparnis != null ? el('span.amount', '−', formatMoney(alt.ersparnis, currency)) : null,
          el('div.t',
            alt.statt, ' → ', alt.empfehlung,
            alt.sicherheit === 'belegt' ? el('span.tag.belegt', 'belegt') : null,
            alt.sicherheit === 'unsicher' ? el('span.tag.unsicher', 'Schätzung') : null,
          ),
          el('div.small.muted', [alt.laden ? `Bei ${alt.laden}.` : null, alt.begruendung].filter(Boolean).join(' ')),
        ),
      );
    }
    add(wrap, card);
  }

  if (ergebnis.positionen?.length) {
    const card = el('div.card');
    const head = el('div.store-head',
      el('div.grow', el('div.name', `Positionen (${ergebnis.positionen.length})`)),
      el('span.small.faint', 'antippen'),
    );
    const list = el('div', { hidden: true });
    head.addEventListener('click', () => {
      list.hidden = !list.hidden;
    });
    for (const line of ergebnis.positionen) {
      add(list, 
        el('div.item',
          el('div', { style: { width: '22px', textAlign: 'center' } }, categoryIcon(line.kategorie)),
          el('div.label',
            el('span.name', line.name, line.unsicher ? el('span.tag.unsicher', '?') : null),
            line.einzelpreis != null && line.menge
              ? el('div.meta', `${line.menge}${line.einheit ? ' ' + line.einheit : ''} · ${formatMoney(line.einzelpreis, currency)}/${line.einheit || 'Einheit'}`)
              : null,
          ),
          el('div.price', formatMoney(line.preis, currency)),
        ),
      );
    }
    add(card, head, list);
    add(wrap, card);
  }

  if (ergebnis.hinweise?.length) {
    add(wrap, 
      el('div.card.card-pad',
        el('div.small.bold', { style: { marginBottom: '4px' } }, 'Nicht sicher gelesen'),
        el('ul.small.muted', { style: { margin: 0, paddingLeft: '18px' } },
          ...ergebnis.hinweise.map((hint) => el('li', hint)),
        ),
      ),
    );
  }

  add(wrap, 
    el('button.btn.block', {
      style: { marginBottom: '14px' },
      onclick: () => {
        lastResult = null;
        rerenderHook();
      },
    }, 'Fertig'),
  );

  return wrap;
}

// ------------------------------------------------------------
// Monatsübersicht
// ------------------------------------------------------------

function monthsCard(settings) {
  const months = store.monthlySpending(6);
  if (!months.length) return el('div');

  const max = Math.max(...months.map((m) => m.total), 1);
  const card = el('div.card');
  add(card, el('div.store-head', el('div.grow', el('div.name', 'Ausgaben pro Monat'))));

  for (const month of months) {
    const [year, mon] = month.month.split('-');
    add(card, 
      el('div.month-row',
        el('div.m', `${mon}.${year.slice(2)}`),
        el('div.track', el('span', { style: { width: `${Math.round((month.total / max) * 100)}%` } })),
        el('div.v', formatMoney(month.total, settings.currency)),
      ),
    );
  }

  if (settings.budget) {
    add(card, 
      el('div.row.small.muted', `Budget: ${formatMoney(settings.budget, settings.currency)} pro Monat`),
    );
  }
  return card;
}

// ------------------------------------------------------------
// Verlauf
// ------------------------------------------------------------

function historyCard(settings) {
  const receipts = store.activeReceipts();
  const trips = store.activeTrips();

  const entries = [
    ...receipts.map((r) => ({ kind: 'receipt', at: r.purchasedAt, data: r })),
    ...trips.map((t) => ({ kind: 'trip', at: t.finishedAt, data: t })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);

  if (!entries.length) {
    return el('div.card', emptyState('🧾', 'Noch kein Verlauf', 'Abgeschlossene Einkäufe und ausgewertete Quittungen sammeln sich hier.'));
  }

  const card = el('div.card');
  add(card, el('div.store-head', el('div.grow', el('div.name', 'Verlauf'))));

  for (const entry of entries) {
    const isReceipt = entry.kind === 'receipt';
    const data = entry.data;
    const label = isReceipt
      ? data.storeName || 'Quittung'
      : (data.payload?.stores ?? []).map((s) => s.storeName).join(', ') || 'Einkauf';
    const count = isReceipt ? (data.payload?.items?.length ?? 0) : (data.payload?.items?.length ?? 0);

    add(card, 
      el('div.row.tappable', {
        onclick: () => (isReceipt ? showReceipt(data, settings) : showTrip(data, settings)),
      },
        el('div', { style: { width: '24px', textAlign: 'center', fontSize: '18px' } }, isReceipt ? '🧾' : '🧺'),
        el('div.grow',
          el('div', label),
          el('div.small.muted', `${relativeDate(entry.at)} · ${count} Artikel`),
        ),
        el('div.bold.nowrap', formatMoney(data.total, settings.currency)),
      ),
    );
  }

  return card;
}

function showReceipt(receipt, settings) {
  sheet(receipt.storeName || 'Quittung', (body, close) => {
    const payload = receipt.payload ?? {};
    for (const thumb of payload.thumbnails ?? []) {
      add(body, el('img.shot', { src: thumb, alt: 'Quittung', style: { maxHeight: '200px' } }));
    }
    add(body, 
      el('div.small.muted', `${relativeDate(receipt.purchasedAt)} · ${formatMoney(receipt.total, settings.currency)}`),
    );

    if (payload.sparplan?.fazit) {
      add(body, el('p.small', payload.sparplan.fazit));
    }

    if (payload.items?.length) {
      const card = el('div.card', { style: { marginTop: '12px' } });
      for (const line of payload.items) {
        add(card, 
          el('div.row',
            el('div.grow', el('div', line.name), line.qty ? el('div.small.muted', `${line.qty} ${line.unit ?? ''}`) : null),
            el('div.nowrap', formatMoney(line.price, settings.currency)),
          ),
        );
      }
      add(body, card);
    }

    add(body, 
      el('div.btn-row',
        el('button.btn.danger', {
          onclick: async () => {
            close();
            if (await confirmSheet('Quittung löschen?', 'Die erkannten Preise bleiben im Gedächtnis erhalten.', { confirmLabel: 'Löschen' })) {
              store.deleteReceipt(receipt.id);
              toast('Quittung gelöscht');
            }
          },
        }, 'Löschen'),
        el('button.btn.primary', { onclick: close }, 'Schliessen'),
      ),
    );
  });
}

function showTrip(trip, settings) {
  sheet('Einkauf', (body, close) => {
    add(body, el('div.small.muted', `${relativeDate(trip.finishedAt)} · ${formatMoney(trip.total, settings.currency)}`));

    for (const bucket of trip.payload?.stores ?? []) {
      add(body, 
        el('div.row',
          el('div.grow', el('div.bold', bucket.storeName), el('div.small.muted', `${bucket.count} Artikel`)),
          el('div.nowrap', formatMoney(bucket.total, settings.currency)),
        ),
      );
    }

    const card = el('div.card', { style: { marginTop: '12px' } });
    for (const line of trip.payload?.items ?? []) {
      add(card, 
        el('div.row',
          el('div.grow', el('div', line.name), el('div.small.muted', line.storeName ?? '')),
          el('div.nowrap', formatMoney(line.price, settings.currency)),
        ),
      );
    }
    add(body, card);

    add(body, 
      el('div.btn-row',
        el('button.btn.danger', {
          onclick: async () => {
            close();
            if (await confirmSheet('Einkauf löschen?', 'Der Eintrag verschwindet aus dem Verlauf.', { confirmLabel: 'Löschen' })) {
              store.deleteTrip(trip.id);
              toast('Einkauf gelöscht');
            }
          },
        }, 'Löschen'),
        el('button.btn.primary', { onclick: close }, 'Schliessen'),
      ),
    );
  });
}
