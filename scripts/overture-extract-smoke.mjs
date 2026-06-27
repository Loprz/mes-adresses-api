#!/usr/bin/env node
/**
 * Overture on-demand extract — standalone smoke test.
 *
 * Validates the *new* Phase 2 DuckDB SQL (divisions + transportation themes)
 * for a single county, in isolation from the NestJS app. Use this to confirm
 * the schema assumptions against a live Overture release before testing the
 * full create flow.
 *
 *   cd mes-adresses-api
 *   node scripts/overture-extract-smoke.mjs 06107            # Tulare County, CA
 *   OVERTURE_RELEASE=2026-05-20.0 node scripts/overture-extract-smoke.mjs 06037
 *
 * Requires @duckdb/node-api (added to package.json — run `yarn install` first)
 * and network access to the Overture S3 bucket (us-west-2).
 *
 * NOTE: the addresses path (Phase 1) is already proven via load_overture.py —
 * test it with:  python3 scripts/load_overture.py --fips <FIPS> --dry-run
 * This script focuses on the net-new streets-fallback queries.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_RELEASE = '2026-05-20.0';

async function resolveRelease() {
  const env = process.env.OVERTURE_RELEASE;
  if (env && env.toLowerCase() !== 'latest') return env.trim();
  try {
    const r = await fetch('https://stac.overturemaps.org/', {
      headers: { Accept: 'application/json' },
    });
    const cat = await r.json();
    if (/^\d{4}-\d{2}-\d{2}\.\d+$/.test(cat?.latest || '')) return cat.latest;
  } catch {
    /* fall through */
  }
  return FALLBACK_RELEASE;
}

const fips = (process.argv[2] || '06107').trim();
const fipsDataPath = path.join(import.meta.dirname, '..', 'us-fips-data.json');
const fipsData = JSON.parse(fs.readFileSync(fipsDataPath, 'utf8'));
const county = fipsData.counties?.[fips];
if (!county) {
  console.error(`No county record for FIPS ${fips} in us-fips-data.json`);
  process.exit(1);
}
const region = `US-${(county.stateAbbr || '').toUpperCase()}`;
const name = county.name;
const safeName = name.replace(/'/g, "''");
const safeRegion = region.replace(/'/g, "''");

const release = await resolveRelease();
const DIVISIONS = `s3://overturemaps-us-west-2/release/${release}/theme=divisions/type=division_area/*`;
const SEGMENTS = `s3://overturemaps-us-west-2/release/${release}/theme=transportation/type=segment/*`;
const BUILDINGS = `s3://overturemaps-us-west-2/release/${release}/theme=buildings/type=building/*`;

console.log(`\nFIPS ${fips} → ${name} (${region})`);
console.log(`Release: ${release}\n`);

const instance = await DuckDBInstance.create(':memory:');
const con = await instance.connect();
await con.run('INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;');
await con.run("SET s3_region='us-west-2';");

// ── 1. Divisions: can we find the county polygon? ─────────────────────────────
console.log('[1/3] Looking up county polygon in divisions theme ...');
const divSql = `
  SELECT names.primary AS name, subtype, region,
         (bbox).xmin AS xmin, (bbox).ymin AS ymin,
         (bbox).xmax AS xmax, (bbox).ymax AS ymax
  FROM read_parquet('${DIVISIONS}', filename=true, hive_partitioning=1)
  WHERE country = 'US'
    AND region = '${safeRegion}'
    AND subtype = 'county'
    AND lower(names.primary) = lower('${safeName}')
  LIMIT 1
`;
const divRows = (await con.runAndReadAll(divSql)).getRowObjects();
if (divRows.length === 0) {
  console.error(
    `  ✗ No division_area match. Check subtype/region/name assumptions.\n` +
      `    Tried subtype='county', region='${region}', name='${name}'.`,
  );
  process.exit(2);
}
console.log(`  ✓ Found: ${divRows[0].name} [${divRows[0].subtype}, ${divRows[0].region}]`);
console.log(
  `    bbox: [${Number(divRows[0].xmin).toFixed(3)}, ${Number(divRows[0].ymin).toFixed(3)}, ` +
    `${Number(divRows[0].xmax).toFixed(3)}, ${Number(divRows[0].ymax).toFixed(3)}]`,
);

// ── 2. Transportation: count named road segments clipped to the county ────────
// Use the bbox numbers from step 1 as SQL *literals* so DuckDB pushes the
// predicate down to Parquet row-group pruning. (Deriving the bounds from a CTE
// instead disables pushdown and scans the entire global theme — ~50x slower.)
console.log('\n[2/3] Counting named road segments within the county ...');
const xmin = Number(divRows[0].xmin);
const ymin = Number(divRows[0].ymin);
const xmax = Number(divRows[0].xmax);
const ymax = Number(divRows[0].ymax);
const countyCte = `
  WITH county AS (
    SELECT geometry AS geom
    FROM read_parquet('${DIVISIONS}', filename=true, hive_partitioning=1)
    WHERE country = 'US' AND region = '${safeRegion}'
      AND subtype = 'county' AND lower(names.primary) = lower('${safeName}')
    LIMIT 1
  )`;
const bboxClause = `
    s.bbox.xmin < ${xmax} AND s.bbox.xmax > ${xmin}
    AND s.bbox.ymin < ${ymax} AND s.bbox.ymax > ${ymin}
    AND s.subtype = 'road' AND s.names.primary IS NOT NULL
    AND ST_Intersects(s.geometry, c.geom)`;
const segSql = `${countyCte}
  SELECT count(*) AS n, count(DISTINCT s.names.primary) AS distinct_names
  FROM read_parquet('${SEGMENTS}', filename=true, hive_partitioning=1) s, county c
  WHERE ${bboxClause}
`;
const t0 = Date.now();
const segRows = (await con.runAndReadAll(segSql)).getRowObjects();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(
  `  ✓ ${Number(segRows[0].n).toLocaleString()} named road segments ` +
    `(${Number(segRows[0].distinct_names).toLocaleString()} distinct names) in ${secs}s`,
);

// Sample a few so you can eyeball the names + geometry type.
const sampleSql = `${countyCte}
  SELECT s.names.primary AS name, s.class AS class,
         ST_GeometryType(s.geometry) AS geom_type
  FROM read_parquet('${SEGMENTS}', filename=true, hive_partitioning=1) s, county c
  WHERE ${bboxClause}
  LIMIT 5
`;
const sample = (await con.runAndReadAll(sampleSql)).getRowObjects();
console.log('\n  Sample:');
for (const row of sample) {
  console.log(`    - ${row.name}  [${row.class}, ${row.geom_type}]`);
}
// ── 3. Buildings: count footprints in a small viewport-sized bbox ─────────────
// Mimics the on-demand map layer: a ~0.04° box near the county center.
console.log('\n[3/3] Counting building footprints in a sample viewport bbox ...');
const cx = (xmin + xmax) / 2;
const cy = (ymin + ymax) / 2;
const bxmin = cx - 0.02;
const bxmax = cx + 0.02;
const bymin = cy - 0.02;
const bymax = cy + 0.02;
const bldSql = `
  SELECT count(*) AS n
  FROM read_parquet('${BUILDINGS}', filename=true, hive_partitioning=1)
  WHERE bbox.xmin < ${bxmax} AND bbox.xmax > ${bxmin}
    AND bbox.ymin < ${bymax} AND bbox.ymax > ${bymin}
`;
const tB = Date.now();
const bldRows = (await con.runAndReadAll(bldSql)).getRowObjects();
console.log(
  `  ✓ ${Number(bldRows[0].n).toLocaleString()} footprints in ` +
    `[${bxmin.toFixed(3)}, ${bymin.toFixed(3)}, ${bxmax.toFixed(3)}, ${bymax.toFixed(3)}] ` +
    `in ${((Date.now() - tB) / 1000).toFixed(1)}s`,
);

console.log('\nDone. If counts look right, the Overture extracts are good to go.\n');
