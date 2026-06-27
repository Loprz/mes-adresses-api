import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';

import {
  OvertureAddressInput,
  OvertureStreetInput,
  OvertureBuildingFeature,
  OvertureBuildingsExtractResult,
} from '../overture.types';
import { bboxForStateFips } from './state-bboxes';
import { CountyMatcher, FipsData, FipsCounty, MatchMethod } from './county-matcher';
import { resolveRelease } from './release';

export type OvertureExtractResult = {
  fipsCode: string;
  release: string;
  addresses: OvertureAddressInput[];
  scanned: number; // rows returned by the state-bbox scan
  matched: number; // rows attributed to this FIPS
  methods: Record<MatchMethod, number>;
};

export type OvertureStreetsExtractResult = {
  fipsCode: string;
  release: string;
  streets: OvertureStreetInput[];
  scanned: number; // segments returned by the county-bbox scan
};

/**
 * OvertureExtractService
 *
 * Runs an on-demand Overture address extract for a single jurisdiction (FIPS)
 * straight from the Overture GeoParquet release on S3, using DuckDB
 * (@duckdb/node-api with the httpfs + spatial extensions).
 *
 * Node port of the proven pipeline in scripts/load_overture.py:
 *   1. Resolve the Overture release (STAC latest unless pinned).
 *   2. One DuckDB scan over the state's bounding box (coarse spatial pre-filter).
 *   3. Attribute-match each row to a county FIPS (source dataset -> city -> ZIP).
 *   4. Keep the rows for the requested FIPS and return them in the flattened
 *      OvertureAddressInput shape that OvertureService.bulkImportFromOverture
 *      consumes (gersId carried through for GERS cross-referencing).
 */
@Injectable()
export class OvertureExtractService implements OnModuleInit {
  private readonly logger = new Logger(OvertureExtractService.name);
  private matcher: CountyMatcher | null = null;
  private fipsData: FipsData | null = null;
  private instance: DuckDBInstance | null = null;

  private getFipsDataPath(): string {
    return (
      process.env.OVERTURE_FIPS_DATA ||
      path.join(process.cwd(), 'us-fips-data.json')
    );
  }

  private getFipsData(): FipsData {
    if (this.fipsData) return this.fipsData;
    this.fipsData = JSON.parse(
      fs.readFileSync(this.getFipsDataPath(), 'utf-8'),
    ) as FipsData;
    return this.fipsData;
  }

  private getCountyInfo(fips: string): FipsCounty {
    const county = this.getFipsData().counties?.[fips];
    if (!county) {
      throw new Error(`No county record in FIPS data for ${fips}`);
    }
    return county;
  }

  private getMatcher(): CountyMatcher {
    if (this.matcher) return this.matcher;
    const fipsData = this.getFipsData();

    // Optional ZIP -> county crosswalk (tier 3, for NAD-sourced states).
    let zipCrosswalk: Record<string, string> | undefined;
    const zxPath = process.env.ZIP_COUNTY_CROSSWALK;
    if (zxPath && fs.existsSync(zxPath)) {
      const raw = JSON.parse(fs.readFileSync(zxPath, 'utf-8')) as Record<
        string,
        string | { countyFips?: string }
      >;
      zipCrosswalk = {};
      for (const [z, v] of Object.entries(raw)) {
        const fips = typeof v === 'string' ? v : v?.countyFips;
        if (fips) zipCrosswalk[z] = fips;
      }
    }

    this.matcher = new CountyMatcher(fipsData, zipCrosswalk);
    return this.matcher;
  }

  private addressesS3Path(release: string): string {
    return (
      `s3://overturemaps-us-west-2/release/${release}` +
      `/theme=addresses/type=address/*`
    );
  }

  private transportationS3Path(release: string): string {
    return (
      `s3://overturemaps-us-west-2/release/${release}` +
      `/theme=transportation/type=segment/*`
    );
  }

  private divisionsS3Path(release: string): string {
    return (
      `s3://overturemaps-us-west-2/release/${release}` +
      `/theme=divisions/type=division_area/*`
    );
  }

  private buildingsS3Path(release: string): string {
    return (
      `s3://overturemaps-us-west-2/release/${release}` +
      `/theme=buildings/type=building/*`
    );
  }

  /**
   * Open a DuckDB connection (spatial + httpfs + S3 ready).
   *
   * The DuckDBInstance is created once and reused across calls so DuckDB's
   * object cache retains Parquet footer/metadata between requests — the dominant
   * cost when scanning the huge Buildings/Transportation themes. Each call still
   * gets its own connection (cheap) to avoid sharing query state.
   */
  private async openConnection() {
    if (!this.instance) {
      this.instance = await DuckDBInstance.create(':memory:');
    }
    const instance = this.instance;
    const connection = await instance.connect();
    await connection.run(
      'INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;',
    );
    await connection.run("SET s3_region='us-west-2';");
    // Cache Parquet metadata across queries within this instance.
    await connection.run('SET enable_object_cache=true;');
    return { instance, connection };
  }

  /**
   * On startup, prime DuckDB's Parquet object cache in the background so the
   * first real request doesn't pay the (large, one-time) cost of reading the
   * Buildings/Transportation theme footers. Non-blocking: app boot does not wait
   * on it. Disable with OVERTURE_PREWARM=false; auto-skipped under test.
   */
  async onModuleInit(): Promise<void> {
    if (
      process.env.OVERTURE_PREWARM === 'false' ||
      process.env.NODE_ENV === 'test'
    ) {
      return;
    }
    // Fire-and-forget: never block or crash startup on a prewarm failure.
    void this.prewarm().catch((err) =>
      this.logger.warn(`Overture prewarm failed: ${err?.message ?? err}`),
    );
  }

  /**
   * Run a cheap, zero-row metadata-priming query per theme. A bbox predicate
   * that matches nothing still forces DuckDB to read each Parquet file's footer
   * (row-group stats) to prune it — exactly the metadata the object cache then
   * retains for subsequent real queries.
   */
  private async prewarm(): Promise<void> {
    const release = await resolveRelease();
    const themes: Array<[string, string]> = [
      ['buildings', this.buildingsS3Path(release)],
      ['transportation', this.transportationS3Path(release)],
      ['addresses', this.addressesS3Path(release)],
    ];
    this.logger.log(`Overture prewarm starting (release ${release}) ...`);
    const { instance, connection } = await this.openConnection();
    try {
      for (const [theme, path] of themes) {
        const t0 = Date.now();
        try {
          await connection.run(
            `SELECT count(*) FROM read_parquet('${path}',
                                filename=true, hive_partitioning=1)
             WHERE bbox.xmin > 1000`,
          );
          this.logger.log(
            `  prewarmed ${theme} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
          );
        } catch (err) {
          this.logger.warn(
            `  prewarm ${theme} failed: ${err?.message ?? err}`,
          );
        }
      }
      this.logger.log('Overture prewarm complete');
    } finally {
      void instance;
    }
  }

  /**
   * Look up a county's bounding box from the Overture Divisions theme.
   *
   * Returning literal numeric bounds (rather than a CTE) is what lets the
   * subsequent address/segment scans push the bbox predicate down to Parquet
   * row-group pruning — the difference between scanning a county's worth of row
   * groups and scanning the entire global theme. Returns null if no county
   * division matches (caller falls back / treats as no data).
   */
  private async fetchCountyExtent(
    connection: any,
    release: string,
    region: string,
    countyName: string,
  ): Promise<{ xmin: number; ymin: number; xmax: number; ymax: number } | null> {
    const safeName = countyName.replace(/'/g, "''");
    const safeRegion = region.replace(/'/g, "''");
    const sql = `
      SELECT (bbox).xmin AS xmin, (bbox).ymin AS ymin,
             (bbox).xmax AS xmax, (bbox).ymax AS ymax
      FROM read_parquet('${this.divisionsS3Path(release)}',
                        filename=true, hive_partitioning=1)
      WHERE country = 'US'
        AND region = '${safeRegion}'
        AND subtype = 'county'
        AND lower(names.primary) = lower('${safeName}')
      LIMIT 1
    `;
    const rows = (await connection.runAndReadAll(sql)).getRowObjects() as Record<
      string,
      any
    >[];
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      xmin: Number(r.xmin),
      ymin: Number(r.ymin),
      xmax: Number(r.xmax),
      ymax: Number(r.ymax),
    };
  }

  /**
   * Extract Overture addresses for a single 5-digit county FIPS.
   *
   * @param fipsCode 5-digit county FIPS (e.g. "06107" for Tulare County, CA)
   * @param release  Overture release override; defaults to STAC latest / env.
   * @param limit    Optional cap on scanned rows (testing). Falls back to
   *                 OVERTURE_EXTRACT_LIMIT env if unset.
   */
  async extractCounty(
    fipsCode: string,
    release?: string,
    limit?: number,
  ): Promise<OvertureExtractResult> {
    const fips = (fipsCode || '').trim();
    if (fips.length !== 5 || !/^\d{5}$/.test(fips)) {
      throw new Error(
        `extractCounty requires a 5-digit county FIPS, got "${fipsCode}"`,
      );
    }
    const stateFips = fips.slice(0, 2);
    const resolvedRelease = await resolveRelease(release);
    const effectiveLimit =
      limit ??
      (process.env.OVERTURE_EXTRACT_LIMIT
        ? parseInt(process.env.OVERTURE_EXTRACT_LIMIT, 10)
        : undefined);
    const limitClause =
      effectiveLimit && effectiveLimit > 0 ? `LIMIT ${effectiveLimit}` : '';

    const t0 = Date.now();
    const { instance, connection } = await this.openConnection();
    let rows: Record<string, any>[];
    let scope: string;
    try {
      // Prefer the county's own bbox (from the Divisions theme) — far smaller
      // than the state bbox and still pushed down to Parquet pruning. Fall back
      // to the state bbox if the county division can't be matched.
      let scanBbox: { xmin: number; ymin: number; xmax: number; ymax: number } | null =
        null;
      const county = this.getFipsData().counties?.[fips];
      if (county) {
        const region = `US-${(county.stateAbbr || '').toUpperCase()}`;
        scanBbox = await this.fetchCountyExtent(
          connection,
          resolvedRelease,
          region,
          county.name,
        );
        if (scanBbox) scope = `county ${county.name}`;
      }
      if (!scanBbox) {
        const sb = bboxForStateFips(stateFips);
        if (!sb) {
          throw new Error(
            `No county division match and no bbox for state FIPS ${stateFips}`,
          );
        }
        scanBbox = { xmin: sb[0], ymin: sb[1], xmax: sb[2], ymax: sb[3] };
        scope = `state ${stateFips}`;
      }

      const sql = `
        SELECT id,
               ST_X(geometry) AS longitude,
               ST_Y(geometry) AS latitude,
               country, postcode, street, number, unit,
               postal_city,
               JSON(address_levels) AS addr_levels,
               JSON(sources) AS sources
        FROM read_parquet('${this.addressesS3Path(resolvedRelease)}',
                          filename=true, hive_partitioning=1)
        WHERE bbox.xmin > ${scanBbox.xmin} AND bbox.xmax < ${scanBbox.xmax}
          AND bbox.ymin > ${scanBbox.ymin} AND bbox.ymax < ${scanBbox.ymax}
          AND country = 'US'
        ${limitClause}
      `;

      this.logger.log(
        `Overture extract: FIPS ${fips} (${scope}) release ${resolvedRelease}`,
      );
      const reader = await connection.runAndReadAll(sql);
      rows = reader.getRowObjects() as Record<string, any>[];
    } finally {
      void instance; // keep instance referenced until the scan completes
    }

    this.logger.log(
      `Scanned ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    const matcher = this.getMatcher();
    const methods: Record<MatchMethod, number> = {
      source: 0,
      city: 0,
      zip: 0,
      none: 0,
    };
    const addresses: OvertureAddressInput[] = [];

    for (const r of rows) {
      const addressLevels = this.parseJson(r.addr_levels);
      const sources = this.parseJson(r.sources);
      const postcode = this.str(r.postcode);

      const [matchedFips, method] = matcher.match({
        addressLevels,
        sources,
        postcode,
      });
      methods[method]++;

      if (matchedFips !== fips) continue;

      const street = this.str(r.street);
      const number = this.str(r.number);
      // Only keep rows that can become an editable numero.
      if (!street || !number) continue;

      addresses.push({
        gersId: this.str(r.id) || '',
        longitude: Number(r.longitude),
        latitude: Number(r.latitude),
        country: this.str(r.country) || 'US',
        postcode: postcode || undefined,
        street,
        number,
        unit: this.str(r.unit) || undefined,
        postalCity: this.str(r.postal_city) || undefined,
        addressLevels,
        sources,
      });
    }

    this.logger.log(
      `Matched ${addresses.length} addresses to FIPS ${fips} ` +
        `(methods: ${JSON.stringify(methods)})`,
    );

    return {
      fipsCode: fips,
      release: resolvedRelease,
      addresses,
      scanned: rows.length,
      matched: addresses.length,
      methods,
    };
  }

  /**
   * Extract the editable street network for a county from the Overture
   * Transportation theme (GA quality). Used as a fallback when a jurisdiction
   * has no/few Overture address points, so the editor never opens on a blank map.
   *
   * Approach (two DuckDB queries on one connection, no per-county bbox table):
   *   1. Look up the county's bbox from the Overture Divisions theme
   *      (division_area, subtype='county') matched by region (US-XX) + name.
   *   2. Scan transportation/type=segment with the bbox bounds as *literals*
   *      (so the predicate is pushed down to Parquet row-group pruning — using
   *      CTE-derived bounds instead silently disables pushdown and scans the
   *      whole global theme), precisely clipped with ST_Intersects against the
   *      county polygon, keeping named road segments only.
   *
   * Each segment becomes one METRIQUE street (voie) carrying its GERS ID, so the
   * scaffold stays linked back to Overture.
   *
   * NOTE: the Divisions schema assumptions (subtype='county', region='US-XX',
   * names.primary == "<County> County") match Overture GA but are validated at
   * runtime against live data — if a county returns zero streets, check the
   * division_area match first.
   */
  async extractStreets(
    fipsCode: string,
    release?: string,
    limit?: number,
  ): Promise<OvertureStreetsExtractResult> {
    const fips = (fipsCode || '').trim();
    if (fips.length !== 5 || !/^\d{5}$/.test(fips)) {
      throw new Error(
        `extractStreets requires a 5-digit county FIPS, got "${fipsCode}"`,
      );
    }
    const county = this.getCountyInfo(fips);
    const region = `US-${(county.stateAbbr || '').toUpperCase()}`;
    const countyName = county.name; // e.g. "Tulare County"
    const resolvedRelease = await resolveRelease(release);

    const effectiveLimit =
      limit ??
      (process.env.OVERTURE_STREETS_LIMIT
        ? parseInt(process.env.OVERTURE_STREETS_LIMIT, 10)
        : undefined);
    const limitClause =
      effectiveLimit && effectiveLimit > 0 ? `LIMIT ${effectiveLimit}` : '';

    // SQL-escape single quotes in the county name.
    const safeName = countyName.replace(/'/g, "''");
    const safeRegion = region.replace(/'/g, "''");

    this.logger.log(
      `Overture streets extract: FIPS ${fips} (${countyName}, ${region}) ` +
        `release ${resolvedRelease}`,
    );
    const t0 = Date.now();

    const { instance, connection } = await this.openConnection();
    let rows: Record<string, any>[];
    try {
      // Step 1: county bbox (literals enable Parquet pushdown in step 2).
      const extent = await this.fetchCountyExtent(
        connection,
        resolvedRelease,
        region,
        countyName,
      );
      if (!extent) {
        this.logger.warn(
          `No county division match for ${countyName} (${region}); ` +
            `cannot extract streets for FIPS ${fips}`,
        );
        return { fipsCode: fips, release: resolvedRelease, streets: [], scanned: 0 };
      }

      // Step 2: scan segments with literal bbox bounds; the CTE supplies only
      // the polygon for the precise ST_Intersects clip.
      const sql = `
        WITH county AS (
          SELECT geometry AS geom
          FROM read_parquet('${this.divisionsS3Path(resolvedRelease)}',
                            filename=true, hive_partitioning=1)
          WHERE country = 'US'
            AND region = '${safeRegion}'
            AND subtype = 'county'
            AND lower(names.primary) = lower('${safeName}')
          LIMIT 1
        )
        SELECT s.id AS id,
               s.names.primary AS name,
               s.class AS class,
               ST_AsGeoJSON(s.geometry) AS geom
        FROM read_parquet('${this.transportationS3Path(resolvedRelease)}',
                          filename=true, hive_partitioning=1) s,
             county c
        WHERE s.bbox.xmin < ${extent.xmax} AND s.bbox.xmax > ${extent.xmin}
          AND s.bbox.ymin < ${extent.ymax} AND s.bbox.ymax > ${extent.ymin}
          AND s.subtype = 'road'
          AND s.names.primary IS NOT NULL
          AND ST_Intersects(s.geometry, c.geom)
        ${limitClause}
      `;
      const reader = await connection.runAndReadAll(sql);
      rows = reader.getRowObjects() as Record<string, any>[];
    } finally {
      void instance; // keep instance referenced until the scan completes
    }

    this.logger.log(
      `Scanned ${rows.length} road segments in ` +
        `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    const streets: OvertureStreetInput[] = [];
    for (const r of rows) {
      const name = this.str(r.name);
      if (!name) continue;
      const geojson = this.parseGeometry(r.geom);
      if (!geojson || geojson.type !== 'LineString') continue;
      const coordinates = geojson.coordinates as [number, number][];
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;

      streets.push({
        gersId: this.str(r.id) || '',
        name,
        class: this.str(r.class) || undefined,
        geometry: { type: 'LineString', coordinates },
      });
    }

    this.logger.log(`Mapped ${streets.length} named road segments to streets`);

    return {
      fipsCode: fips,
      release: resolvedRelease,
      streets,
      scanned: rows.length,
    };
  }

  /**
   * Extract Overture building footprints overlapping a viewport bbox, returned
   * as GeoJSON features carrying each building's GERS ID (Phase 3).
   *
   * Meant to back a viewport-driven map layer: the frontend only requests this
   * at high zoom, so the bbox is small and the literal-bbox predicate prunes the
   * Parquet scan to a handful of row groups. A LIMIT caps the payload.
   *
   * @param bbox  [minLng, minLat, maxLng, maxLat] (WGS84)
   * @param release Overture release override; defaults to STAC latest / env.
   * @param limit Max footprints to return (env OVERTURE_BUILDINGS_LIMIT, def 5000).
   */
  async extractBuildings(
    bbox: [number, number, number, number],
    release?: string,
    limit?: number,
  ): Promise<OvertureBuildingsExtractResult> {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    if ([minLng, minLat, maxLng, maxLat].some((n) => !Number.isFinite(n))) {
      throw new Error(`extractBuildings requires a numeric bbox, got ${bbox}`);
    }
    const resolvedRelease = await resolveRelease(release);
    const effectiveLimit =
      limit ??
      (process.env.OVERTURE_BUILDINGS_LIMIT
        ? parseInt(process.env.OVERTURE_BUILDINGS_LIMIT, 10)
        : 5000);

    const sql = `
      SELECT id AS id, class AS class, ST_AsGeoJSON(geometry) AS geom
      FROM read_parquet('${this.buildingsS3Path(resolvedRelease)}',
                        filename=true, hive_partitioning=1)
      WHERE bbox.xmin < ${maxLng} AND bbox.xmax > ${minLng}
        AND bbox.ymin < ${maxLat} AND bbox.ymax > ${minLat}
      LIMIT ${effectiveLimit > 0 ? effectiveLimit : 5000}
    `;

    const t0 = Date.now();
    const { instance, connection } = await this.openConnection();
    let rows: Record<string, any>[];
    try {
      const reader = await connection.runAndReadAll(sql);
      rows = reader.getRowObjects() as Record<string, any>[];
    } finally {
      void instance; // keep instance referenced until the scan completes
    }

    const features: OvertureBuildingFeature[] = [];
    for (const r of rows) {
      const geometry = this.parseGeometry(r.geom);
      if (!geometry) continue;
      features.push({
        type: 'Feature',
        geometry,
        properties: {
          gersId: this.str(r.id) || '',
          class: this.str(r.class) || undefined,
        },
      });
    }

    this.logger.log(
      `Overture buildings: ${features.length} footprints in bbox ` +
        `[${minLng},${minLat},${maxLng},${maxLat}] ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );

    return { release: resolvedRelease, features, scanned: rows.length };
  }

  private parseGeometry(value: unknown): { type: string; coordinates: any } | null {
    if (value == null) return null;
    if (typeof value === 'object') return value as any;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return null;
  }

  private parseJson(value: unknown): any[] {
    if (value == null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private str(value: unknown): string | undefined {
    if (value == null) return undefined;
    return String(value);
  }
}
