/**
 * US FIPS Code Utilities
 *
 * Replaces the French COG (Code Officiel Géographique) utilities.
 * Provides lookup and validation for US geographic identifiers:
 *
 * - State FIPS codes (2-digit): e.g. "06" = California
 * - County FIPS codes (5-digit): e.g. "06037" = Los Angeles County, CA
 * - Place FIPS codes (7-digit): e.g. "0644000" = Los Angeles city, CA
 *
 * Places include incorporated cities, towns, villages, and boroughs.
 * A LAB (Local Address Base) can be scoped to either a city/town OR a county
 * (for unincorporated areas).
 *
 * Data sourced from the U.S. Census Bureau:
 * https://www.census.gov/library/reference/code-lists/ansi.html
 */

import * as fipsData from '../../../../us-fips-data.json';
import * as jurisdictionEmailsData from '../../../../us-jurisdiction-emails.json';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type USState = {
  code: string; // 2-digit state FIPS code
  abbr: string; // 2-letter postal abbreviation (e.g. "CA")
  name: string; // Full name (e.g. "California")
};

export type USCounty = {
  code: string; // 5-digit county FIPS code (state + county)
  stateFips: string; // 2-digit state FIPS code
  stateAbbr: string; // 2-letter state abbreviation
  name: string; // County name (e.g. "Los Angeles County")
};

export type USPlace = {
  code: string; // 7-digit place FIPS code (state + place)
  stateFips: string; // 2-digit state FIPS code
  stateAbbr: string; // 2-letter state abbreviation
  name: string; // Place name (e.g. "Los Angeles city")
  type: string; // "city" | "town" | "village" | "borough" | "place"
  countyFips: string | null; // Parent county FIPS (null if spans multiple counties)
  countyName: string; // Parent county name(s)
};

/**
 * A Jurisdiction is either a city/town (Place) or a county.
 * Cities and towns are the primary addressing authority for incorporated areas.
 * Counties handle addressing for unincorporated areas.
 */
export type Jurisdiction = {
  code: string; // FIPS code (5-digit for county, 7-digit for place)
  stateFips: string;
  stateAbbr: string;
  name: string;
  level: 'place' | 'county'; // Distinguishes city vs county
  type?: string; // For places: "city", "town", "village", "borough"
  countyFips?: string | null; // Parent county (for places)
  countyName?: string; // Parent county name (for places)
};

// ─── Data indexes ───────────────────────────────────────────────────────────────

const statesIndex: Record<string, USState> = fipsData.states as Record<
  string,
  USState
>;
const countiesIndex: Record<string, USCounty> = fipsData.counties as Record<
  string,
  USCounty
>;
const placesIndex: Record<string, USPlace> = (
  (fipsData as any).places || {}
) as Record<string, USPlace>;

// Jurisdiction email data
const countyEmailsIndex: Record<string, { emails: string[] }> =
  ((jurisdictionEmailsData as any).counties || {}) as Record<
    string,
    { emails: string[] }
  >;
const placeEmailsIndex: Record<string, { emails: string[] }> =
  ((jurisdictionEmailsData as any).places || {}) as Record<
    string,
    { emails: string[] }
  >;

const stateCodeSet = new Set(Object.keys(statesIndex));
const countyCodeSet = new Set(Object.keys(countiesIndex));
const placeCodeSet = new Set(Object.keys(placesIndex));

// ─── Lookup functions ───────────────────────────────────────────────────────────

/**
 * Get a state by its 2-digit FIPS code
 */
export function getState(stateFips: string): USState | undefined {
  return statesIndex[stateFips];
}

/**
 * Get a county by its 5-digit FIPS code
 */
export function getCounty(countyFips: string): USCounty | undefined {
  return countiesIndex[countyFips];
}

/**
 * Get a place (city/town/village/borough) by its 7-digit FIPS code
 */
export function getPlace(placeFips: string): USPlace | undefined {
  return placesIndex[placeFips];
}

/**
 * Get a jurisdiction by its FIPS code — works for both places (7-digit) and counties (5-digit).
 * Places (cities/towns) are checked first since they are the more common addressing authority.
 */
export function getJurisdiction(fipsCode: string): Jurisdiction | undefined {
  // Check places first (7-digit)
  const place = getPlace(fipsCode);
  if (place) {
    return {
      code: place.code,
      stateFips: place.stateFips,
      stateAbbr: place.stateAbbr,
      name: place.name,
      level: 'place',
      type: place.type,
      countyFips: place.countyFips,
      countyName: place.countyName,
    };
  }

  // Then check counties (5-digit)
  const county = getCounty(fipsCode);
  if (county) {
    return {
      code: county.code,
      stateFips: county.stateFips,
      stateAbbr: county.stateAbbr,
      name: county.name,
      level: 'county',
    };
  }

  return undefined;
}

/**
 * Get the display name for a jurisdiction code.
 * For places: "Los Angeles city, CA"
 * For counties: "Los Angeles County, CA" with "(unincorporated)" hint
 */
export function getJurisdictionName(fipsCode: string): string | undefined {
  const place = getPlace(fipsCode);
  if (place) {
    return `${place.name}, ${place.stateAbbr}`;
  }

  const county = getCounty(fipsCode);
  if (county) {
    return `${county.name}, ${county.stateAbbr}`;
  }

  return undefined;
}

// ─── Validation functions ───────────────────────────────────────────────────────

/**
 * Check if a code is a valid 2-digit state FIPS code
 */
export function isValidState(code: string): boolean {
  return stateCodeSet.has(code);
}

/**
 * Check if a code is a valid 5-digit county FIPS code
 */
export function isValidCounty(code: string): boolean {
  return countyCodeSet.has(code);
}

/**
 * Check if a code is a valid 7-digit place FIPS code
 */
export function isValidPlace(code: string): boolean {
  return placeCodeSet.has(code);
}

/**
 * Check if a code is a valid jurisdiction — either a place (7-digit) or county (5-digit).
 * This is the US equivalent of the French `isCommuneActuelle()`.
 */
export function isValidJurisdiction(code: string): boolean {
  return isValidPlace(code) || isValidCounty(code);
}

/**
 * Check if a code is a valid FIPS code (state, county, or place).
 * This is the US equivalent of the French `isCommune()`.
 */
export function isValidFips(code: string): boolean {
  return isValidState(code) || isValidCounty(code) || isValidPlace(code);
}

// ─── List functions ─────────────────────────────────────────────────────────────

/**
 * Get all states
 */
export function getAllStates(): USState[] {
  return Object.values(statesIndex);
}

/**
 * Get all counties
 */
export function getAllCounties(): USCounty[] {
  return Object.values(countiesIndex);
}

/**
 * Get all places (cities, towns, villages, boroughs)
 */
export function getAllPlaces(): USPlace[] {
  return Object.values(placesIndex);
}

/**
 * Get all counties in a state by state FIPS code
 */
export function getCountiesByState(stateFips: string): USCounty[] {
  return Object.values(countiesIndex).filter(
    (c) => c.stateFips === stateFips,
  );
}

/**
 * Get all places in a state by state FIPS code
 */
export function getPlacesByState(stateFips: string): USPlace[] {
  return Object.values(placesIndex).filter(
    (p) => p.stateFips === stateFips,
  );
}

/**
 * Get all places within a county by county FIPS code
 */
export function getPlacesByCounty(countyFips: string): USPlace[] {
  return Object.values(placesIndex).filter(
    (p) => p.countyFips === countyFips,
  );
}

/**
 * Get all places that should appear under a county selector.
 *
 * Most places map directly through `countyFips`, but some Census place records
 * span multiple counties and store a comma-separated `countyName` list instead.
 * Those should still be selectable from each matching county.
 */
export function getSelectablePlacesByCounty(countyFips: string): USPlace[] {
  const county = getCounty(countyFips);

  if (!county) {
    return [];
  }

  const countyName = county.name.trim().toLowerCase();

  return Object.values(placesIndex).filter((place) => {
    if (place.countyFips === countyFips) {
      return true;
    }

    if (place.stateFips !== county.stateFips || !place.countyName) {
      return false;
    }

    return place.countyName
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .includes(countyName);
  });
}

// ─── Search functions ────────────────────────────────────────────────────────

export type JurisdictionSearchResult = {
  code: string;
  nom: string;
  departement: { code: string; nom: string }; // "departement" for API compat with frontend
  type?: string; // "city" | "town" | "village" | "borough" | "county"
  level: 'place' | 'county'; // Distinguishes city/town from county
  countyName?: string; // Parent county for places
  _score: number;
};

/**
 * Search jurisdictions by name and/or state abbreviation.
 * Returns BOTH cities/towns and counties, with cities ranked higher
 * since they are the more common addressing authority.
 *
 * Returns results compatible with the French geo API format the frontend expects.
 *
 * Examples:
 *   searchJurisdictions("Los Angeles")       → Los Angeles city, CA (then county)
 *   searchJurisdictions("Ashland OR")         → Ashland city, OR
 *   searchJurisdictions("Cook IL")            → Cook County, IL (+ cities in Cook County)
 *   searchJurisdictions("0644000")            → exact 7-digit place FIPS match
 *   searchJurisdictions("06037")              → exact 5-digit county FIPS match
 *   searchJurisdictions("CA")                 → all jurisdictions in California
 */
export function searchJurisdictions(
  query: string,
  limit = 20,
): JurisdictionSearchResult[] {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const q = query.trim();

  // Exact 7-digit place FIPS code match
  if (/^\d{7}$/.test(q)) {
    const place = getPlace(q);
    if (place) {
      return [placeToSearchResult(place, 1.0)];
    }
    return [];
  }

  // Exact 5-digit county FIPS code match
  if (/^\d{5}$/.test(q)) {
    const county = getCounty(q);
    if (county) {
      return [countyToSearchResult(county, 1.0)];
    }
    return [];
  }

  // Extract state abbreviation or FIPS code from query tokens
  const tokens = q.split(/\s+/);
  let stateFilter: string | null = null;
  let nameTokens = [...tokens];

  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i].toUpperCase();
    // 2-letter state abbreviation
    const stateByAbbr = Object.values(statesIndex).find(
      (s) => s.abbr === token,
    );
    if (stateByAbbr) {
      stateFilter = stateByAbbr.code;
      nameTokens.splice(i, 1);
      break;
    }
    // 2-digit state FIPS code
    if (/^\d{2}$/.test(token) && isValidState(token)) {
      stateFilter = token;
      nameTokens.splice(i, 1);
      break;
    }
  }

  const nameQuery = nameTokens.join(' ').toLowerCase();

  // Get candidate places and counties
  const allPlaces = Object.values(placesIndex);
  const allCounties = Object.values(countiesIndex);

  let candidatePlaces = stateFilter
    ? allPlaces.filter((p) => p.stateFips === stateFilter)
    : allPlaces;
  let candidateCounties = stateFilter
    ? allCounties.filter((c) => c.stateFips === stateFilter)
    : allCounties;

  // If no name query (just state filter), return a mix of cities and counties
  if (!nameQuery && stateFilter) {
    const placeResults = candidatePlaces
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, Math.ceil(limit * 0.7))
      .map((p) => placeToSearchResult(p, 0.5));
    const countyResults = candidateCounties
      .slice(0, Math.floor(limit * 0.3))
      .map((c) => countyToSearchResult(c, 0.4));
    return [...placeResults, ...countyResults].slice(0, limit);
  }

  // Score places
  const scoredPlaces = candidatePlaces.map((place) => {
    const score = scoreMatch(place.name, nameQuery, nameTokens);
    // Boost cities/towns over generic "place" types
    const typeBoost = place.type === 'city' || place.type === 'town' ? 0.05 : 0;
    return { result: placeToSearchResult(place, score + typeBoost), score: score + typeBoost };
  });

  // Score counties
  const scoredCounties = candidateCounties.map((county) => {
    const score = scoreMatch(county.name, nameQuery, nameTokens);
    // Slight penalty for counties so cities rank first for same name
    return { result: countyToSearchResult(county, score), score: score - 0.01 };
  });

  // Combine, filter, sort, and limit
  const allScored = [...scoredPlaces, ...scoredCounties];

  return allScored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.result);
}

/**
 * Score how well a name matches a query.
 */
function scoreMatch(
  name: string,
  nameQuery: string,
  nameTokens: string[],
): number {
  const lowerName = name.toLowerCase();
  // Strip common suffixes for matching (e.g. "Los Angeles city" → "los angeles")
  const cleanName = lowerName
    .replace(/\s+(city|town|village|borough|county|cdp)$/i, '')
    .trim();

  if (cleanName === nameQuery || lowerName === nameQuery) {
    return 1.0;
  }
  if (cleanName.startsWith(nameQuery) || lowerName.startsWith(nameQuery)) {
    return 0.9;
  }
  if (cleanName.includes(nameQuery) || lowerName.includes(nameQuery)) {
    return 0.7;
  }

  // Check individual tokens
  const matchingTokens = nameTokens.filter(
    (t) => cleanName.includes(t.toLowerCase()) || lowerName.includes(t.toLowerCase()),
  );
  return (matchingTokens.length / Math.max(nameTokens.length, 1)) * 0.5;
}

function placeToSearchResult(
  place: USPlace,
  score: number,
): JurisdictionSearchResult {
  const state = getState(place.stateFips);
  return {
    code: place.code,
    nom: place.name,
    departement: {
      code: state?.abbr || place.stateAbbr,
      nom: state?.name || place.stateAbbr,
    },
    type: place.type,
    level: 'place',
    countyName: place.countyName,
    _score: score,
  };
}

function countyToSearchResult(
  county: USCounty,
  score: number,
): JurisdictionSearchResult {
  const state = getState(county.stateFips);
  return {
    code: county.code,
    nom: county.name,
    departement: {
      code: state?.abbr || county.stateAbbr,
      nom: state?.name || county.stateAbbr,
    },
    type: 'county',
    level: 'county',
    _score: score,
  };
}

// ─── Jurisdiction email functions ─────────────────────────────────────────────

/**
 * Get pre-registered official emails for a jurisdiction (county or city/town).
 *
 * If the jurisdiction has registered emails in the emails data file, those are returned.
 * Otherwise, a placeholder email pattern is generated based on the jurisdiction name
 * (e.g., "clerk@fresno-county.ca.gov") so that jurisdictions can be onboarded later.
 *
 * @param fipsCode - 5-digit county or 7-digit place FIPS code
 * @returns Array of official email addresses
 */
export function getJurisdictionEmails(fipsCode: string): string[] {
  // Check places first (7-digit)
  if (fipsCode.length === 7 && placeEmailsIndex[fipsCode]) {
    return placeEmailsIndex[fipsCode].emails.map((e) => e.toLowerCase());
  }

  // Then check counties (5-digit)
  if (fipsCode.length === 5 && countyEmailsIndex[fipsCode]) {
    return countyEmailsIndex[fipsCode].emails.map((e) => e.toLowerCase());
  }

  // Generate placeholder emails if not pre-registered
  const jurisdiction = getJurisdiction(fipsCode);
  if (!jurisdiction) {
    return [];
  }

  const stateAbbr = jurisdiction.stateAbbr.toLowerCase();
  const cleanName = jurisdiction.name
    .toLowerCase()
    .replace(/\s+(city|town|village|borough|county|cdp)$/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  if (jurisdiction.level === 'place') {
    return [`clerk@${cleanName}.${stateAbbr}.gov`];
  }

  // County
  return [`clerk@${cleanName}-county.${stateAbbr}.gov`];
}
