// Markdown-Renderer, klein und sicher.
//
// Baut echte DOM-Knoten statt HTML-Strings: Nutzertext geht nur
// durch textContent, nie durch innerHTML. Damit ist eingeschleustes
// <script> von vornherein wirkungslos - wichtig, sobald Notizen
// ueber den Sync von einem zweiten Geraet kommen.
//
// Absichtlich kein volles CommonMark. Was eine Notiz-App braucht:
// Titel, Listen, Haekchen, Zitate, Code, fett/kursiv, Links - und
// als Herzstueck [[Verlinkungen]] und #tags.

import { el, add } from './util.js';

/**
 * @param {string} text   Markdown-Quelltext
 * @param {object} hooks  onWikiLink(titel), onTag(tag), onToggleTask(zeilenIndex, neuerWert)
 * @returns {HTMLElement}
 */
export function renderMarkdown(text, hooks = {}) {
  const root = el('div.md');
  const lines = String(text ?? '').split('\n');

  let i = 0;
  let list = null; // { node, ordered }

  const closeList = () => { list = null; };

  const ensureList = (ordered) => {
    if (list && list.ordered === ordered) return list.node;
    const node = el(ordered ? 'ol' : 'ul');
    add(root, node);
    list = { node, ordered };
    return node;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code-Zaun: alles bis zum schliessenden ``` woertlich uebernehmen.
    if (trimmed.startsWith('```')) {
      closeList();
      const buffer = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1; // schliessender Zaun
      add(root, el('pre', el('code', buffer.join('\n'))));
      continue;
    }

    if (!trimmed) {
      closeList();
      i += 1;
      continue;
    }

    // Ueberschriften
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      add(root, el(`h${Math.min(level + 1, 5)}.md-h`, inline(heading[2], hooks)));
      i += 1;
      continue;
    }

    // Trennlinie
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      closeList();
      add(root, el('hr'));
      i += 1;
      continue;
    }

    // Zitat
    if (trimmed.startsWith('>')) {
      closeList();
      const quote = el('blockquote');
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        add(quote, el('p', inline(lines[i].trim().replace(/^>\s?/, ''), hooks)));
        i += 1;
      }
      add(root, quote);
      continue;
    }

    // Aufgabenzeile: - [ ] / - [x], antippbar
    const task = trimmed.match(/^[-*]\s+\[( |x|X)\]\s?(.*)$/);
    if (task) {
      const listNode = ensureList(false);
      const lineIndex = i;
      const checked = task[1].toLowerCase() === 'x';
      const box = el('span.taskbox', { class: checked ? 'on' : '' }, checked ? '✓' : '');
      const item = el('li.task', { class: checked ? 'done' : '' }, box, el('span', inline(task[2], hooks)));
      if (hooks.onToggleTask) {
        item.addEventListener('click', (event) => {
          // Links in der Zeile sollen navigieren, nicht abhaken.
          if (event.target.closest('a, .wikilink, .tag-inline')) return;
          hooks.onToggleTask(lineIndex, !checked);
        });
        item.classList.add('tappable');
      }
      add(listNode, item);
      i += 1;
      continue;
    }

    // Aufzaehlung / Nummerierung
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      add(ensureList(false), el('li', inline(bullet[1], hooks)));
      i += 1;
      continue;
    }
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      add(ensureList(true), el('li', inline(numbered[1], hooks)));
      i += 1;
      continue;
    }

    // Absatz
    closeList();
    add(root, el('p', inline(trimmed, hooks)));
    i += 1;
  }

  return root;
}

// ------------------------------------------------------------
// Inline-Elemente
// ------------------------------------------------------------

// Reihenfolge zaehlt: Code zuerst (darin gilt nichts anderes), dann
// Verlinkungen, dann Betonung. Ein Muster pro Durchlauf, das am
// weitesten links steht, gewinnt.
const INLINE = [
  { re: /`([^`]+)`/, make: (m) => el('code', m[1]) },
  { re: /\[\[([^\[\]\n]+?)\]\]/, make: (m, hooks) => wikiLink(m[1], hooks) },
  { re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/, make: (m) => extLink(m[2], m[1]) },
  { re: /(https?:\/\/[^\s<>")\]]+)/, make: (m) => extLink(m[1], m[1]) },
  // Wortgrenze und Zeichenklasse identisch mit extractTags (state.js),
  // damit jeder gerenderte Chip auch als Tag der Notiz erfasst ist.
  { re: /(^|[\s(])#([a-zäöüéèA-ZÄÖÜ][\wäöüÄÖÜéè-]*)/, make: (m, hooks) => [m[1], tagChip(m[2], hooks)] },
  { re: /\*\*([^*\n]+)\*\*/, make: (m, hooks) => el('strong', inline(m[1], hooks)) },
  { re: /\*([^*\n]+)\*/, make: (m, hooks) => el('em', inline(m[1], hooks)) },
];

function inline(text, hooks) {
  const out = [];
  let rest = String(text ?? '');

  while (rest) {
    let best = null;
    for (const rule of INLINE) {
      const match = rule.re.exec(rest);
      if (match && (best == null || match.index < best.match.index)) {
        best = { rule, match };
      }
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.match.index > 0) out.push(rest.slice(0, best.match.index));
    out.push(best.rule.make(best.match, hooks));
    rest = rest.slice(best.match.index + best.match[0].length);
  }
  return out.flat();
}

function wikiLink(titel, hooks) {
  const clean = titel.trim();
  const node = el('a.wikilink', { href: '#' }, clean);
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hooks.onWikiLink?.(clean);
  });
  return node;
}

function tagChip(tag, hooks) {
  const node = el('a.tag-inline', { href: '#' }, `#${tag}`);
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hooks.onTag?.(tag.toLowerCase());
  });
  return node;
}

function extLink(url, label) {
  // rel="noopener": die Zielseite bekommt kein window.opener und kann
  // die App nicht umlenken.
  return el('a.extlink', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
}

/**
 * Eine Aufgabenzeile im Quelltext umschalten. Gibt den neuen Text
 * zurueck - der Aufrufer speichert.
 */
export function toggleTaskLine(text, lineIndex, checked) {
  const lines = String(text ?? '').split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return text;
  lines[lineIndex] = lines[lineIndex].replace(
    /^(\s*[-*]\s+\[)( |x|X)(\])/,
    `$1${checked ? 'x' : ' '}$3`,
  );
  return lines.join('\n');
}

/** Kurzer Klartext-Auszug fuer Listenzeilen - ohne Markdown-Zeichen. */
export function excerpt(text, max = 90) {
  const plain = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\[\]\n]+?)\]\]/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trim()} …` : plain;
}
