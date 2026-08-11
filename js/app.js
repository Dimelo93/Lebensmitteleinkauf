// Startpunkt: Zustand laden, Ansichten verdrahten, Abgleich starten.

import { add, el, clear, debounce } from './util.js';
import * as store from './state.js';
import * as sync from './sync.js';
import { toast } from './ui/shell.js';

import * as liste from './ui/liste.js';
import * as laeden from './ui/laeden.js';
import * as vorlagen from './ui/vorlagen.js';
import * as budget from './ui/budget.js';
import * as mehr from './ui/mehr.js';

const TABS = [
  { id: 'liste', icon: '🧺', label: 'Liste', view: liste },
  { id: 'laeden', icon: '🏬', label: 'Läden', view: laeden },
  { id: 'vorlagen', icon: '⭐', label: 'Vorlagen', view: vorlagen },
  { id: 'budget', icon: '💸', label: 'Budget', view: budget },
  { id: 'mehr', icon: '⚙️', label: 'Mehr', view: mehr },
];

let current = 'liste';
let addbarSignature = null;

const nodes = {
  title: document.getElementById('title'),
  subtitle: document.getElementById('subtitle'),
  view: document.getElementById('view'),
  tabbar: document.getElementById('tabbar'),
  addbarSlot: document.getElementById('addbar-slot'),
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
};

// ------------------------------------------------------------
// Zeichnen
// ------------------------------------------------------------

function activeTab() {
  return TABS.find((tab) => tab.id === current) ?? TABS[0];
}

function renderTabs() {
  clear(nodes.tabbar);
  for (const tab of TABS) {
    add(nodes.tabbar, 
      el('button', {
        'aria-current': tab.id === current ? 'page' : null,
        onclick: () => go(tab.id),
      },
        el('span.ico', tab.icon),
        el('span', tab.label),
      ),
    );
  }
}

function render() {
  const tab = activeTab();

  nodes.title.firstChild.textContent = tab.view.title();
  nodes.subtitle.textContent = tab.view.subtitle();

  clear(nodes.view);
  add(nodes.view, tab.view.render());

  // Die Eingabeleiste wird bewusst nicht bei jedem Zustandswechsel neu
  // gebaut - sonst verlierst du beim Tippen Text und Fokus.
  const signature = tab.view.addbar
    ? `${tab.id}:${store.activeStores().map((s) => `${s.id}${s.name}${s.color}`).join('|')}`
    : tab.id;

  if (signature !== addbarSignature) {
    addbarSignature = signature;
    clear(nodes.addbarSlot);
    if (tab.view.addbar) add(nodes.addbarSlot, tab.view.addbar());
  }

  scheduleMeasure();
}

const scheduleRender = debounce(render, 16);

/**
 * Höhen der festen Leisten als CSS-Variablen bereitstellen.
 *
 * Die Kopfzeile ist unterschiedlich hoch (Titel mit oder ohne Untertitel,
 * Notch), und die Eingabeleiste gibt es nur auf der Liste. Ohne diese
 * Messung klebt die Ladenüberschrift an der falschen Stelle und der
 * Hinweisbalken deckt das Eingabefeld zu.
 */
function measureChrome() {
  const root = document.documentElement.style;
  root.setProperty('--topbar-h', `${Math.round(document.querySelector('.topbar').offsetHeight)}px`);
  root.setProperty('--addbar-h', `${Math.round(nodes.addbarSlot.offsetHeight)}px`);
  root.setProperty('--tabbar-h', `${Math.round(nodes.tabbar.offsetHeight)}px`);
}

const scheduleMeasure = debounce(measureChrome, 60);

function go(id) {
  if (current === id) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  current = id;
  history.replaceState(null, '', `#${id}`);
  renderTabs();
  render();
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------
// Verbindungsanzeige
// ------------------------------------------------------------

const STATUS_LABEL = {
  local: { text: 'Nur hier', css: '' },
  connecting: { text: 'Verbinde …', css: '' },
  ready: { text: 'Verbunden', css: 'online' },
  online: { text: 'Synchron', css: 'online' },
  offline: { text: 'Offline', css: 'offline' },
  error: { text: 'Fehler', css: 'error' },
};

let letzterStatus = null;

function paintStatus(status) {
  const info = STATUS_LABEL[status.state] ?? STATUS_LABEL.local;
  const pending = store.outboxSize();

  letzterStatus = status;
  nodes.status.hidden = false;
  nodes.status.className = `status ${info.css}`.trim();
  nodes.statusText.textContent = pending > 0 && status.state !== 'online'
    ? `${info.text} · ${pending}`
    : info.text;
  // title ist auf dem Telefon nicht erreichbar - es gibt kein
  // Schwebenlassen. Der Grund muss auf Antippen kommen, sonst steht
  // da nur "Fehler" und niemand erfaehrt, welcher.
  nodes.status.title = status.detail ?? '';
}

nodes.status.addEventListener('click', () => {
  const detail = letzterStatus?.detail;
  if (detail) toast(detail, { ms: 9000 });
});

// ------------------------------------------------------------
// Service Worker
// ------------------------------------------------------------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  try {
    const registration = await navigator.serviceWorker.register('sw.js');

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Neue Version bereit', {
            action: 'Neu laden',
            onAction: () => {
              installing.postMessage({ type: 'SKIP_WAITING' });
              location.reload();
            },
            ms: 8000,
          });
        }
      });
    });
  } catch (err) {
    console.warn('Service Worker nicht registriert', err);
  }
}

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

function boot() {
  store.load();

  // Rückkanal für Ansichten, die eigenen Zustand halten.
  vorlagen.setRerender(render);
  budget.setRerender(render);
  mehr.setRerender(render);

  const fromHash = location.hash.replace('#', '');
  if (TABS.some((tab) => tab.id === fromHash)) current = fromHash;

  renderTabs();
  render();
  measureChrome();
  window.addEventListener('resize', scheduleMeasure);
  window.addEventListener('orientationchange', scheduleMeasure);

  store.subscribe(scheduleRender);
  sync.onStatus(paintStatus);
  sync.installListeners();
  sync.connect();

  registerServiceWorker();

  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (TABS.some((tab) => tab.id === id) && id !== current) go(id);
  });

  // Beim Zurückkehren in die App den Bildschirm auffrischen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRender();
  });
}

boot();
