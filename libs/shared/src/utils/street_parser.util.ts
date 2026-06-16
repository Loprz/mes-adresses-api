/**
 * CLDXF-US street-name parser.
 *
 * Splits a full street name (e.g. "North Main Street", "W 6th St",
 * "Avenue 232", "County Road 1057") into the NENA NG9-1-1 / CLDXF-US
 * components used by the Site/Structure Address Point layer:
 *
 *   [St_PreDir] [St_PreTyp] St_Name [St_PosTyp] [St_PosDir]
 *
 * Directionals and types are emitted as the full-word forms NENA stores
 * (e.g. "North", "Avenue"). This is a pragmatic parser tuned for US county
 * data, not a full NENA Registry implementation — unknown types simply stay in
 * the name body, which is the safe failure mode.
 */

export interface ParsedStreetName {
  preDir: string;
  preType: string;
  name: string;
  postType: string;
  postDir: string;
}

const DIRECTIONALS: Record<string, string> = {
  n: 'North', s: 'South', e: 'East', w: 'West',
  ne: 'Northeast', nw: 'Northwest', se: 'Southeast', sw: 'Southwest',
  north: 'North', south: 'South', east: 'East', west: 'West',
  northeast: 'Northeast', northwest: 'Northwest',
  southeast: 'Southeast', southwest: 'Southwest',
};

// Common Street Name Post Type abbreviations → NENA full form. Subset of the
// NENA Registry; extend as needed.
const POST_TYPES: Record<string, string> = {
  st: 'Street', street: 'Street',
  ave: 'Avenue', av: 'Avenue', avenue: 'Avenue',
  blvd: 'Boulevard', boulevard: 'Boulevard',
  rd: 'Road', road: 'Road',
  dr: 'Drive', drive: 'Drive',
  ln: 'Lane', lane: 'Lane',
  ct: 'Court', court: 'Court',
  cir: 'Circle', circle: 'Circle',
  hwy: 'Highway', highway: 'Highway',
  pkwy: 'Parkway', parkway: 'Parkway',
  pl: 'Place', place: 'Place',
  ter: 'Terrace', terr: 'Terrace', terrace: 'Terrace',
  way: 'Way',
  trl: 'Trail', trail: 'Trail',
  loop: 'Loop',
  pike: 'Pike',
  run: 'Run',
  path: 'Path',
  xing: 'Crossing', crossing: 'Crossing',
  sq: 'Square', square: 'Square',
  plz: 'Plaza', plaza: 'Plaza',
  cv: 'Cove', cove: 'Cove',
  bnd: 'Bend', bend: 'Bend',
  pass: 'Pass',
  rte: 'Route', route: 'Route',
  row: 'Row',
  walk: 'Walk',
  cres: 'Crescent', crescent: 'Crescent',
  aly: 'Alley', alley: 'Alley',
  expy: 'Expressway', expressway: 'Expressway',
  frwy: 'Freeway', fwy: 'Freeway', freeway: 'Freeway',
  blf: 'Bluff', bluff: 'Bluff',
};

// Pre-types: type word appears BEFORE the name (often numeric), e.g.
// "Avenue 232", "Road 24". Multiword phrases are checked first.
const PRE_TYPE_PHRASES: string[] = [
  'county road', 'state highway', 'state route', 'us highway', 'farm to market',
  'county route', 'old highway', 'interstate',
];
const PRE_TYPE_WORDS: Record<string, string> = {
  avenue: 'Avenue', ave: 'Avenue', av: 'Avenue',
  road: 'Road', rd: 'Road',
  highway: 'Highway', hwy: 'Highway',
  route: 'Route', rte: 'Route',
  calle: 'Calle', avenida: 'Avenida', camino: 'Camino', via: 'Via',
};

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

function key(tok: string): string {
  return tok.toLowerCase().replace(/[.,]/g, '');
}

export function parseStreetName(raw: string): ParsedStreetName {
  const out: ParsedStreetName = {
    preDir: '', preType: '', name: '', postType: '', postDir: '',
  };
  if (!raw || !raw.trim()) return out;

  let toks = raw.trim().replace(/\s+/g, ' ').split(' ');

  // 1) Trailing post-directional (only if something precedes it).
  if (toks.length >= 2 && DIRECTIONALS[key(toks[toks.length - 1])]) {
    out.postDir = DIRECTIONALS[key(toks.pop() as string)];
  }

  // 2) Trailing post-type (only if a name would remain).
  if (toks.length >= 2 && POST_TYPES[key(toks[toks.length - 1])]) {
    out.postType = POST_TYPES[key(toks.pop() as string)];
  }

  // 3) Leading pre-directional (only if something follows it).
  if (toks.length >= 2 && DIRECTIONALS[key(toks[0])]) {
    out.preDir = DIRECTIONALS[key(toks.shift() as string)];
  }

  // 4) Pre-type: multiword phrase, then single word — only when no post-type was
  //    found and a (usually numeric) name remains.
  if (!out.postType && toks.length >= 2) {
    const lead2 = `${key(toks[0])} ${key(toks[1])}`;
    if (PRE_TYPE_PHRASES.includes(lead2) && toks.length >= 3) {
      out.preType = titleCase(`${toks[0]} ${toks[1]}`);
      toks = toks.slice(2);
    } else if (PRE_TYPE_WORDS[key(toks[0])]) {
      out.preType = PRE_TYPE_WORDS[key(toks[0])];
      toks = toks.slice(1);
    }
  }

  out.name = toks.join(' ').trim();
  return out;
}
