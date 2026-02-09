/**
 * Overture Maps Foundation — Type Definitions
 *
 * These types represent the Overture Maps address schema and GERS
 * (Global Entity Reference System) data structures used for
 * bidirectional data exchange between the National Address Platform
 * and the Overture Maps ecosystem.
 *
 * GERS IDs are UUID v4 identifiers that remain stable across Overture
 * monthly releases, covering 446M+ address points from 175+ sources.
 *
 * See: https://docs.overturemaps.org/schema/reference/addresses/address
 * See: https://docs.overturemaps.org/gers
 */

// ─── Overture Address Feature (GeoParquet schema) ───────────────────────────

export type OvertureAddressLevel = {
  value?: string; // Administrative level value (e.g., state abbr, city name)
};

export type OvertureSource = {
  property?: string;
  dataset?: string;
  recordId?: string;
  confidence?: number;
};

export type OvertureAddress = {
  id: string; // GERS ID (UUID v4)
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude] WGS84
  };
  bbox?: {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
  };
  properties: {
    theme: 'addresses';
    type: 'address';
    version: number;
    country: string; // ISO 3166-1 alpha-2 (e.g., "US")
    postcode?: string;
    street?: string;
    number?: string;
    unit?: string;
    postal_city?: string;
    address_levels?: OvertureAddressLevel[]; // [state, city] for US
    sources?: OvertureSource[];
  };
};

// ─── GERS Registry Entry ─────────────────────────────────────────────────────

export type GersRegistryEntry = {
  id: string; // GERS UUID
  version: number;
  first_seen: string; // Release date when first published
  last_seen: string; // Most recent release containing this entity
  last_changed: string; // Release date when last modified
  path: string; // Theme/type path (e.g., "addresses/address")
  bbox?: {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
  };
};

// ─── Import/Export Types ─────────────────────────────────────────────────────

export type OvertureImportResult = {
  totalProcessed: number;
  matched: number; // Existing addresses matched by proximity + name
  created: number; // New addresses imported
  skipped: number; // Duplicates or out-of-jurisdiction
  errors: number;
  gersIdsLinked: number; // GERS IDs assigned to existing addresses
};

export type OvertureExportRecord = {
  nap_id: string; // Our internal ID
  ban_id: string; // Our platform UUID
  gers_id: string | null; // Linked Overture GERS ID (null if unmatched)
  country: 'US';
  state: string; // 2-letter state abbreviation
  county_fips: string; // 5-digit county FIPS
  street: string;
  number: string;
  unit?: string;
  postcode?: string;
  city?: string;
  longitude: number;
  latitude: number;
  certified: boolean;
  last_updated: string; // ISO 8601 date
};

// ─── Match Confidence ────────────────────────────────────────────────────────

export enum MatchConfidence {
  EXACT = 'exact', // Same coordinates + same address string
  HIGH = 'high', // Within 25m + fuzzy name match
  MEDIUM = 'medium', // Within 50m + partial name match
  LOW = 'low', // Within 100m + loose match
  NONE = 'none', // No match found
}

export type GersMatchResult = {
  gersId: string;
  confidence: MatchConfidence;
  overtureAddress: OvertureAddress;
  distance: number; // meters between points
};

// ─── Overture Data Source Configuration ──────────────────────────────────────

export type OvertureDataConfig = {
  /** S3/Azure path to Overture GeoParquet release files */
  releasePath: string;
  /** Overture release version tag (e.g., "2025-06-25") */
  releaseVersion: string;
  /** Filter to US addresses only */
  countryFilter: 'US';
  /** Optional FIPS filter to limit to specific counties */
  countyFipsFilter?: string[];
};

// ─── Bulk Import Types ──────────────────────────────────────────────────────

/**
 * Input format for a single Overture address to import.
 * This is a flattened version of the GeoParquet columns.
 */
export type OvertureAddressInput = {
  gersId: string; // Overture GERS ID (UUID v4)
  longitude: number; // WGS84 longitude
  latitude: number; // WGS84 latitude
  country: string; // "US"
  postcode?: string;
  street: string; // Street name
  number: string; // House/address number
  unit?: string; // Unit/suite/apt
  postalCity?: string;
  addressLevels?: OvertureAddressLevel[]; // [state, city]
  sources?: OvertureSource[];
};

/**
 * Result of a bulk import operation.
 */
export type OvertureBulkImportResult = {
  balId: string; // Created LAB ID
  token: string; // LAB access token (for editing)
  fipsCode: string; // Jurisdiction FIPS code
  jurisdictionName: string;
  totalInput: number; // Addresses in the input
  streetsCreated: number; // Unique streets created
  addressesCreated: number; // Address numbers created
  positionsCreated: number; // Position points created
  gersIdsLinked: number; // GERS IDs assigned
  skipped: number; // Addresses skipped (no street, no number, etc.)
  durationMs: number; // Total import time
};
