// Abteilungen und Artikelwissen. Wird gebraucht, damit ein neu
// getippter Artikel automatisch in der richtigen Abteilung landet
// und eine sinnvolle Einheit vorgeschlagen bekommt.

import { normalize, stem } from './util.js';

export const CATEGORIES = [
  { id: 'gemuese', label: 'Früchte & Gemüse', icon: '🥕' },
  { id: 'fleisch', label: 'Fleisch & Fisch', icon: '🥩' },
  { id: 'molkerei', label: 'Milch, Käse & Eier', icon: '🧀' },
  { id: 'brot', label: 'Brot & Backwaren', icon: '🥖' },
  { id: 'tiefkuehl', label: 'Tiefkühl', icon: '🧊' },
  { id: 'vorrat', label: 'Trockenwaren & Vorrat', icon: '🍝' },
  { id: 'konserven', label: 'Konserven, Saucen & Gewürze', icon: '🥫' },
  { id: 'getraenke', label: 'Getränke', icon: '🥤' },
  { id: 'snacks', label: 'Süsses & Snacks', icon: '🍫' },
  { id: 'haushalt', label: 'Haushalt & Reinigung', icon: '🧽' },
  { id: 'drogerie', label: 'Drogerie & Hygiene', icon: '🧴' },
  { id: 'sonstiges', label: 'Sonstiges', icon: '📦' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export function categoryLabel(id) {
  return CATEGORY_BY_ID[id]?.label ?? CATEGORY_BY_ID.sonstiges.label;
}

export function categoryIcon(id) {
  return CATEGORY_BY_ID[id]?.icon ?? CATEGORY_BY_ID.sonstiges.icon;
}

// Reihenfolge der Abteilungen im Laden. Die meisten Schweizer
// Filialen laufen von Gemuese ueber Frischware zu Trockenwaren
// und enden bei Non-Food - danach ist die Liste sortiert.
export const CATEGORY_ORDER = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]));

// Stichwort -> Abteilung. Bewusst mit Schweizer Ausdruecken,
// Halal-Metzgerei und Asia-Laden, weil genau die im Standard-
// Woerterbuch einer Einkaufs-App sonst fehlen.
const KEYWORDS = {
  gemuese: [
    'apfel', 'aepfel', 'birne', 'banane', 'orange', 'mandarine', 'clementine', 'zitrone', 'limette',
    'traube', 'trauben', 'erdbeere', 'himbeere', 'heidelbeere', 'blaubeere', 'brombeere', 'kirsche',
    'pfirsich', 'nektarine', 'aprikose', 'zwetschge', 'pflaume', 'melone', 'wassermelone', 'ananas',
    'mango', 'kiwi', 'avocado', 'granatapfel', 'feige', 'dattel', 'papaya', 'litschi', 'khaki',
    'tomate', 'cherrytomate', 'gurke', 'salat', 'kopfsalat', 'nuesslisalat', 'nuesslisalaat', 'eisbergsalat',
    'rucola', 'lollo', 'spinat', 'mangold', 'kohl', 'weisskohl', 'rotkohl', 'wirz', 'blumenkohl',
    'broccoli', 'brokkoli', 'rosenkohl', 'kohlrabi', 'fenchel', 'lauch', 'sellerie', 'randen', 'rande',
    'ruebli', 'rueebli', 'karotte', 'moehre', 'zwiebel', 'schalotte', 'knoblauch', 'ingwer', 'kurkuma',
    'kartoffel', 'gschwellti', 'suesskartoffel', 'zucchetti', 'zucchini', 'aubergine', 'peperoni',
    'peperoncini', 'chili', 'kuerbis', 'spargel', 'bohne', 'erbse', 'zuckerschote', 'mais', 'radiesli',
    'radieschen', 'rettich', 'pilz', 'champignon', 'kraeuterseitling', 'shiitake', 'petersilie',
    'schnittlauch', 'basilikum', 'koriander', 'minze', 'thymian', 'rosmarin', 'dill', 'salbei',
    'lauchzwiebel', 'fruehlingszwiebel', 'pak choi', 'bok choy', 'chinakohl', 'edamame', 'okra',
    'aubergine', 'sprossen', 'keimling', 'kresse', 'olive',
  ],
  fleisch: [
    'poulet', 'huhn', 'haehnchen', 'pouletbrust', 'pouletschenkel', 'flueguel', 'truthahn', 'pute',
    'rind', 'rindfleisch', 'hackfleisch', 'hack', 'gehacktes', 'hackbraten', 'entrecote', 'filet',
    'steak', 'plaetzli', 'schnitzel', 'geschnetzeltes', 'ragout', 'voressen', 'braten', 'gulasch',
    'kalb', 'kalbfleisch', 'lamm', 'lammfleisch', 'lammhack', 'lammkotelett', 'gigot', 'kotelett',
    'schwein', 'speck', 'schinken', 'rohschinken', 'salami', 'aufschnitt', 'wurst', 'cervelat',
    'bratwurst', 'wienerli', 'landjaeger', 'merguez', 'sucuk', 'pastrami', 'doener', 'kebab',
    'halal', 'sujuk', 'kalbsbratwurst', 'trockenfleisch', 'bresaola', 'mortadella',
    'fisch', 'lachs', 'thunfisch', 'forelle', 'egli', 'felchen', 'zander', 'dorsch', 'kabeljau',
    'seelachs', 'crevette', 'crevetten', 'garnele', 'shrimp', 'tintenfisch', 'calamari', 'muschel',
    'sardine', 'sardelle', 'raeucherlachs',
  ],
  molkerei: [
    'milch', 'vollmilch', 'halbrahm', 'rahm', 'sahne', 'vollrahm', 'kaffeerahm', 'creme fraiche',
    'sauerrahm', 'joghurt', 'jogurt', 'skyr', 'quark', 'huettenkaese', 'cottage', 'mascarpone',
    'ricotta', 'frischkaese', 'philadelphia', 'butter', 'margarine', 'ei', 'eier', 'kaese',
    'gruyere', 'greyerzer', 'emmentaler', 'appenzeller', 'tilsiter', 'raclette', 'fondue',
    'mozzarella', 'parmesan', 'feta', 'halloumi', 'schafskaese', 'ziegenkaese', 'camembert', 'brie',
    'gorgonzola', 'cheddar', 'reibkaese', 'streichkaese', 'ayran', 'kefir', 'labneh', 'sojamilch',
    'hafermilch', 'mandelmilch', 'kokosjoghurt', 'pudding', 'dessertcreme',
  ],
  brot: [
    'brot', 'ruchbrot', 'halbweissbrot', 'vollkornbrot', 'buurebrot', 'zopf', 'weggli', 'buerli',
    'baguette', 'ciabatta', 'toast', 'toastbrot', 'sandwichbrot', 'brotchen', 'broetchen', 'gipfeli',
    'croissant', 'brioche', 'fladenbrot', 'pita', 'pide', 'lavash', 'naan', 'tortilla', 'wrap',
    'knaeckebrot', 'zwieback', 'crackers', 'semmelbroesel', 'paniermehl', 'kuchen', 'wurzel',
    'sesamkringel', 'simit', 'boerek', 'blaetterteig', 'kuchenteig', 'pizzateig', 'hefe',
  ],
  tiefkuehl: [
    'tiefkuehl', 'tk', 'gefroren', 'glace', 'eis', 'speiseeis', 'pommes', 'pommes frites', 'wedges',
    'roesti', 'nuggets', 'fischstaebchen', 'pizza', 'lasagne', 'tiefkuehlgemuese', 'erbsli',
    'blattspinat', 'beerenmischung', 'gyoza', 'dimsum', 'samosa', 'fruehlingsrolle', 'sorbet',
  ],
  vorrat: [
    'reis', 'basmati', 'jasminreis', 'risotto', 'arborio', 'parboiled', 'wildreis', 'bulgur',
    'couscous', 'quinoa', 'hirse', 'polenta', 'griess', 'haferflocken', 'muesli', 'birchermuesli',
    'cornflakes', 'mehl', 'ruchmehl', 'zopfmehl', 'weissmehl', 'vollkornmehl', 'zucker', 'puderzucker',
    'salz', 'backpulver', 'natron', 'vanillezucker', 'staerke', 'maizena', 'pasta', 'spaghetti',
    'penne', 'fusilli', 'hoernli', 'tagliatelle', 'lasagneblaetter', 'nudeln', 'reisnudeln',
    'glasnudeln', 'ramen', 'udon', 'linsen', 'kichererbsen', 'bohnen', 'kidneybohnen', 'sojabohnen',
    'nuss', 'nuesse', 'mandel', 'baumnuss', 'walnuss', 'haselnuss', 'cashew', 'pistazie', 'erdnuss',
    'rosine', 'trockenfruechte', 'kokosraspel', 'oel', 'olivenoel', 'sonnenblumenoel', 'rapsoel',
    'sesamoel', 'kokosoel', 'essig', 'balsamico', 'kaffee', 'kaffeebohnen', 'kapsel', 'tee',
    'schwarztee', 'gruentee', 'kraeutertee', 'honig', 'konfituere', 'marmelade', 'nutella',
    'erdnussbutter', 'tahini', 'sesampaste', 'gelatine',
  ],
  konserven: [
    'pelati', 'tomatenpuree', 'passata', 'dosentomaten', 'mais', 'konserve', 'dose', 'buechse',
    'thon', 'sardinen', 'oliven', 'essiggurken', 'gurken', 'kapern', 'sugo', 'pastasauce',
    'pesto', 'ketchup', 'mayonnaise', 'mayo', 'senf', 'sauce', 'sojasauce', 'sojasosse', 'teriyaki',
    'austernsauce', 'fischsauce', 'sriracha', 'sambal', 'gochujang', 'miso', 'currypaste',
    'kokosmilch', 'bouillon', 'brühe', 'bruehe', 'aromat', 'maggi', 'gewuerz', 'pfeffer', 'paprika',
    'curry', 'kreuzkuemmel', 'kuemmel', 'zimt', 'muskat', 'lorbeer', 'oregano', 'sumach', 'zaatar',
    'baharat', 'harissa', 'garam masala', 'chiliflocken', 'safran', 'kardamom', 'nelken', 'anis',
    'hummus', 'baba ganoush', 'falafel', 'tahin', 'ajvar', 'tomatenmark',
  ],
  getraenke: [
    'wasser', 'mineralwasser', 'sprudel', 'saft', 'orangensaft', 'apfelsaft', 'multivitamin',
    'sirup', 'rivella', 'cola', 'fanta', 'sprite', 'eistee', 'ice tea', 'energy', 'red bull',
    'bier', 'wein', 'rotwein', 'weisswein', 'prosecco', 'sekt', 'schnaps', 'gin', 'vodka', 'whisky',
    'ovomaltine', 'kakao', 'smoothie', 'limonade', 'tonic', 'ayran',
  ],
  snacks: [
    'schokolade', 'schoggi', 'toblerone', 'lindt', 'ragusa', 'branche', 'kinder', 'riegel',
    'guetzli', 'biscuit', 'keks', 'petit beurre', 'waffel', 'chips', 'nachos', 'salzstangen',
    'popcorn', 'bonbon', 'gummibaerchen', 'haribo', 'lakritze', 'kaugummi', 'traubenzucker',
    'nussmischung', 'studentenfutter', 'baklava', 'halva', 'lokum', 'mochi', 'pocky',
  ],
  haushalt: [
    'abfallsack', 'kehrichtsack', 'zuerisack', 'muellsack', 'putzmittel', 'wc reiniger', 'wc ente',
    'allzweckreiniger', 'entkalker', 'spuelmittel', 'abwaschmittel', 'geschirrspueler', 'tabs',
    'waschmittel', 'weichspueler', 'fleckenentferner', 'schwamm', 'lappen', 'haushaltspapier',
    'kuechenrolle', 'backpapier', 'alufolie', 'frischhaltefolie', 'gefrierbeutel', 'ziploc',
    'kerze', 'batterie', 'gluehbirne', 'streichholz', 'staubsaugerbeutel', 'buegeleisen',
  ],
  drogerie: [
    'wc papier', 'toilettenpapier', 'papiertaschentuch', 'taschentuch', 'kleenex', 'zahnpasta',
    'zahnbuerste', 'zahnseide', 'mundwasser', 'shampoo', 'spuelung', 'duschgel', 'seife',
    'handseife', 'deo', 'deodorant', 'rasierer', 'rasierschaum', 'creme', 'bodylotion',
    'sonnencreme', 'windel', 'feuchttuecher', 'binden', 'tampon', 'pflaster', 'desinfektion',
    'vitamin', 'magnesium', 'schmerzmittel', 'dafalgan', 'aspirin', 'nasenspray', 'wattestaebchen',
  ],
};

// Stichwort -> passende Einheit, wo die Standardeinheit "Stück"
// offensichtlich falsch waere.
const UNIT_HINTS = [
  [/^(milch|vollmilch|rahm|sahne|saft|wasser|oel|essig|sirup|bier|wein|sojamilch|hafermilch|mandelmilch)/, 'l'],
  [/^(hack|hackfleisch|gehacktes|poulet|huhn|rind|kalb|lamm|schwein|fleisch|fisch|lachs|crevett|garnele|kaese|reis|mehl|zucker|kartoffel|zwiebel|tomate|ruebli|rueebli|karotte|nuss|mandel|linsen|kichererbse|bulgur|couscous|traube|apfel|banane)/, 'kg'],
  [/^(joghurt|jogurt|butter|quark|honig|konfituere|pasta|spaghetti|penne|hoernli|nudeln)/, 'g'],
  [/^(ei|eier)$/, 'Stk'],
];

export const UNITS = ['Stk', 'g', 'kg', 'ml', 'dl', 'l', 'Pack', 'Bund', 'Dose', 'Flasche', 'Glas', 'Becher', 'Beutel', 'Schale', 'x'];

const LOOKUP = new Map();
for (const [category, words] of Object.entries(KEYWORDS)) {
  for (const word of words) {
    const key = normalize(word);
    if (!key) continue;
    if (!LOOKUP.has(key)) LOOKUP.set(key, category);
    const stemmed = key.split(' ').map(stem).join(' ');
    if (!LOOKUP.has(stemmed)) LOOKUP.set(stemmed, category);
  }
}

/**
 * Raet die Abteilung zu einem Artikelnamen. Erst exakter Treffer,
 * dann Wortweise, dann Teilwort (damit "Bio-Vollmilch 1l" auch
 * bei "vollmilch" landet). Ohne Treffer: sonstiges.
 */
export function guessCategory(name) {
  const norm = normalize(name);
  if (!norm) return 'sonstiges';

  if (LOOKUP.has(norm)) return LOOKUP.get(norm);

  const words = norm.split(' ').filter(Boolean);
  for (const word of words) {
    if (LOOKUP.has(word)) return LOOKUP.get(word);
    const stemmed = stem(word);
    if (LOOKUP.has(stemmed)) return LOOKUP.get(stemmed);
  }

  // Teilwort-Treffer, laengste Uebereinstimmung gewinnt, damit
  // "kaesekuchen" nicht am kurzen "ei" haengenbleibt.
  let best = null;
  for (const [key, category] of LOOKUP) {
    if (key.length < 4) continue;
    if (norm.includes(key) && (!best || key.length > best.length)) best = { key, category, length: key.length };
  }
  return best?.category ?? 'sonstiges';
}

export function guessUnit(name, category = null) {
  const norm = normalize(name);
  for (const [pattern, unit] of UNIT_HINTS) {
    if (pattern.test(norm)) return unit;
  }
  if (category === 'getraenke') return 'l';
  return 'Stk';
}

