#!/usr/bin/env python3
"""
Overture Maps → National Address Platform (NAP) Bulk Importer

Downloads address data from the Overture Maps Foundation S3 bucket
and imports it into the NAP system via the bulk import API endpoint.

Usage:
    # Import Fresno County (FIPS 06019) — first 50,000 addresses
    python3 scripts/import-overture.py --fips 06019 --limit 50000

    # Import all addresses for a FIPS code
    python3 scripts/import-overture.py --fips 06019

    # Import from a pre-downloaded JSON file
    python3 scripts/import-overture.py --fips 06019 --file overture-fresno-county-addresses.json

    # Import a specific city (7-digit place FIPS)
    python3 scripts/import-overture.py --fips 0627000  # Fresno city

    # Import a specific city using Overture locality boundary filtering
    python3 scripts/import-overture.py --fips 0625436 --city-boundary on

Requirements:
    pip3 install duckdb requests
"""

import argparse
import json
import os
import re
import sys
import time

# Local helper (scripts/ is on sys.path when run as a script).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from overture_release import resolve_release  # noqa: E402

# ──────────────────────────────────────────────────────────────────────────────
# Overture release and API configuration
# ──────────────────────────────────────────────────────────────────────────────

# NOTE: load_overture.py is the go-forward, US-scalable loader. This script is
# retained for single-jurisdiction and Overture locality-boundary imports.
# The release is resolved at runtime (STAC latest) in main(); this is only a
# fallback so the module imports without a network call.
OVERTURE_RELEASE = "2026-05-20.0"
OVERTURE_S3_PATH = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=addresses/type=address/*"
OVERTURE_DIVISIONS_PATH = (
    f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=divisions/type=division/*"
)
OVERTURE_DIVISION_AREAS_PATH = (
    f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=divisions/type=division_area/*"
)
API_BASE = os.environ.get("NAP_API_URL", "http://localhost:5050")


def _set_release(release: str) -> None:
    """Repoint the S3 path globals at a resolved Overture release."""
    global OVERTURE_RELEASE, OVERTURE_S3_PATH
    global OVERTURE_DIVISIONS_PATH, OVERTURE_DIVISION_AREAS_PATH
    OVERTURE_RELEASE = release
    base = f"s3://overturemaps-us-west-2/release/{release}"
    OVERTURE_S3_PATH = f"{base}/theme=addresses/type=address/*"
    OVERTURE_DIVISIONS_PATH = f"{base}/theme=divisions/type=division/*"
    OVERTURE_DIVISION_AREAS_PATH = f"{base}/theme=divisions/type=division_area/*"
API_IMPORT_ENDPOINT = f"{API_BASE}/v2/overture/import"

# County bounding boxes for Overture spatial filtering (approx)
# Format: { fips: (xmin, ymin, xmax, ymax) }
COUNTY_BBOXES = {
    "06019": (-120.92, 35.79, -119.01, 37.59),   # Fresno County, CA
    "06037": (-118.95, 33.70, -117.65, 34.82),    # Los Angeles County, CA
    "06073": (-117.60, 32.53, -116.08, 33.51),    # San Diego County, CA
    "06085": (-122.20, 36.89, -121.21, 37.48),    # Santa Clara County, CA
    "48201": (-95.79, 29.50, -95.01, 30.18),      # Harris County, TX (Houston)
    "17031": (-88.26, 41.47, -87.52, 42.15),      # Cook County, IL (Chicago)
    "04013": (-113.33, 32.51, -111.04, 34.04),    # Maricopa County, AZ (Phoenix)
}


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def get_fips_metadata(fips: str) -> dict:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    fips_path = os.path.normpath(os.path.join(script_dir, "..", "us-fips-data.json"))

    with open(fips_path, "r") as f:
        data = json.load(f)

    place = data.get("places", {}).get(fips)
    county = data.get("counties", {}).get(fips)
    return {
        "place": place,
        "county": county,
    }


def get_bbox_for_fips(fips: str, explicit_bbox: tuple | None) -> tuple | None:
    if explicit_bbox:
        return explicit_bbox

    if fips in COUNTY_BBOXES:
        return COUNTY_BBOXES[fips]

    # Place FIPS (7-digit): derive county bbox when available
    if len(fips) == 7:
        metadata = get_fips_metadata(fips)
        place = metadata.get("place")
        if place:
            county_fips = place.get("countyFips")
            if county_fips in COUNTY_BBOXES:
                print(
                    f"Using parent county bbox ({county_fips}) for place FIPS {fips} ({place.get('name')})"
                )
                return COUNTY_BBOXES[county_fips]

    return None


def get_overture_locality_name_candidates(place_name: str) -> list[str]:
    # Overture locality names often omit legal suffixes in Census place labels
    # (e.g. "Fowler city" -> "Fowler").
    base = place_name.strip()
    simplified = re.sub(
        r"\s+(city|town|village|borough|municipio|cdp)$",
        "",
        base,
        flags=re.IGNORECASE,
    ).strip()

    candidates = [base]
    if simplified and simplified.lower() != base.lower():
        candidates.append(simplified)

    # Preserve order, remove case-insensitive duplicates
    seen = set()
    unique = []
    for name in candidates:
        key = name.lower()
        if key not in seen:
            seen.add(key)
            unique.append(name)
    return unique


def download_from_overture(
    fips: str,
    bbox: tuple,
    limit: int | None = None,
    locality_names: list[str] | None = None,
) -> list:
    """Download address data from Overture Maps S3 via DuckDB."""
    try:
        import duckdb
    except ImportError:
        print("ERROR: duckdb not installed. Run: pip3 install duckdb")
        sys.exit(1)

    xmin, ymin, xmax, ymax = bbox
    print(f"Connecting to Overture Maps S3 ({OVERTURE_RELEASE})...")
    print(f"  Bounding box: ({xmin}, {ymin}) → ({xmax}, {ymax})")

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")

    limit_clause = f"LIMIT {limit}" if limit else ""
    locality_join_clause = ""
    locality_cte_clause = ""

    if locality_names:
        quoted_names = ", ".join(
            f"'{sql_escape(name.lower())}'" for name in locality_names
        )
        print(f"  Locality boundary filter: {', '.join(locality_names)}")

        locality_cte_clause = f"""
        , locality_candidates AS (
            SELECT d.id AS division_id
            FROM read_parquet('{OVERTURE_DIVISIONS_PATH}', filename=true, hive_partitioning=1) d
            WHERE d.country = 'US'
              AND d.subtype = 'locality'
              AND lower(d.names.primary) IN ({quoted_names})
        ),
        locality_area AS (
            SELECT a.geometry
            FROM read_parquet('{OVERTURE_DIVISION_AREAS_PATH}', filename=true, hive_partitioning=1) a
            JOIN locality_candidates c
              ON a.division_id = c.division_id
            WHERE a.class = 'land'
              AND a.bbox.xmax > {xmin} AND a.bbox.xmin < {xmax}
              AND a.bbox.ymax > {ymin} AND a.bbox.ymin < {ymax}
            ORDER BY ST_Area(a.geometry) DESC
            LIMIT 1
        )
        """

        boundary_count = con.execute(f"""
            WITH locality_candidates AS (
                SELECT d.id AS division_id
                FROM read_parquet('{OVERTURE_DIVISIONS_PATH}', filename=true, hive_partitioning=1) d
                WHERE d.country = 'US'
                  AND d.subtype = 'locality'
                  AND lower(d.names.primary) IN ({quoted_names})
            )
            SELECT COUNT(*) FROM locality_candidates
        """).fetchone()[0]

        if boundary_count == 0:
            print(
                f"ERROR: Could not resolve Overture locality boundary for '{', '.join(locality_names)}'."
            )
            print("       Try --city-boundary off and provide a tighter --bbox.")
            sys.exit(1)

        locality_join_clause = "JOIN locality_area la ON ST_Intersects(la.geometry, addr.geometry)"

    print("Querying Overture addresses...")
    t0 = time.time()

    result = con.execute(f"""
        WITH
        addr AS (
            SELECT *
            FROM read_parquet('{OVERTURE_S3_PATH}', filename=true, hive_partitioning=1)
            WHERE bbox.xmin > {xmin} AND bbox.xmax < {xmax}
              AND bbox.ymin > {ymin} AND bbox.ymax < {ymax}
              AND country = 'US'
        )
        {locality_cte_clause}
        SELECT id,
               ST_X(addr.geometry) as longitude,
               ST_Y(addr.geometry) as latitude,
               country, postcode, street, number, unit,
               postal_city,
               JSON(address_levels) as addr_levels,
               JSON(sources) as sources
        FROM addr
        {locality_join_clause}
        {limit_clause}
    """).fetchall()

    elapsed = time.time() - t0
    print(f"  Fetched {len(result):,} addresses in {elapsed:.1f}s")
    con.close()

    # Convert to JSON-serializable format
    addresses = []
    for row in result:
        addr = {
            "gersId": row[0],
            "longitude": row[1],
            "latitude": row[2],
            "country": row[3],
            "postcode": row[4],
            "street": row[5],
            "number": row[6],
            "unit": row[7],
            "postalCity": row[8],
            "addressLevels": json.loads(row[9]) if row[9] else [],
            "sources": json.loads(row[10]) if row[10] else [],
        }
        addresses.append(addr)

    return addresses


def load_from_file(filepath: str) -> list:
    """Load address data from a pre-downloaded JSON file."""
    print(f"Loading addresses from {filepath}...")
    with open(filepath, "r") as f:
        addresses = json.load(f)
    print(f"  Loaded {len(addresses):,} addresses")
    return addresses


def send_to_api(fips: str, addresses: list, email: str | None = None, chunk_size: int = 10000) -> dict:
    """Send addresses to the NAP import API in chunks."""
    try:
        import requests
    except ImportError:
        print("ERROR: requests not installed. Run: pip3 install requests")
        sys.exit(1)

    total = len(addresses)
    print(f"\nImporting {total:,} addresses into FIPS {fips}...")
    print(f"  API endpoint: {API_IMPORT_ENDPOINT}")
    print(f"  Chunk size: {chunk_size:,}")

    # Single-payload import. For very large counties that exceed the API body
    # limit, use load_overture.py (chunked + append).
    payload = {
        "fipsCode": fips,
        "addresses": addresses,
        "release": OVERTURE_RELEASE,
    }
    if email:
        payload["email"] = email

    payload_size = len(json.dumps(payload)) / 1024 / 1024
    print(f"  Payload size: {payload_size:.1f} MB")

    t0 = time.time()
    response = requests.post(
        API_IMPORT_ENDPOINT,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=600,  # 10 min timeout for large imports
    )
    elapsed = time.time() - t0

    if response.status_code != 200:
        print(f"  ERROR: API returned {response.status_code}")
        print(f"  Response: {response.text[:500]}")
        sys.exit(1)

    result = response.json()
    print(f"\n{'='*60}")
    print(f"  IMPORT COMPLETE ({elapsed:.1f}s)")
    print(f"{'='*60}")
    print(f"  LAB ID:           {result.get('balId')}")
    print(f"  Token:            {result.get('token')}")
    print(f"  Jurisdiction:     {result.get('jurisdictionName')}")
    print(f"  Streets created:  {result.get('streetsCreated'):,}")
    print(f"  Addresses:        {result.get('addressesCreated'):,}")
    print(f"  GERS IDs linked:  {result.get('gersIdsLinked'):,}")
    print(f"  Skipped:          {result.get('skipped'):,}")
    print(f"  Duration:         {result.get('durationMs', 0) / 1000:.1f}s")
    print(f"  Editor URL:       {result.get('editorUrl')}")
    print(f"{'='*60}")

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Import Overture Maps addresses into the National Address Platform"
    )
    parser.add_argument(
        "--fips",
        required=True,
        help="FIPS code (5-digit county or 7-digit place)",
    )
    parser.add_argument(
        "--file",
        help="Path to a pre-downloaded JSON file (skips S3 download)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max number of addresses to import",
    )
    parser.add_argument(
        "--email",
        default=None,
        help="Admin email for the created LAB",
    )
    parser.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        metavar=("XMIN", "YMIN", "XMAX", "YMAX"),
        help="Custom bounding box for S3 query (overrides built-in bbox)",
    )
    parser.add_argument(
        "--save-json",
        help="Save downloaded data to a JSON file before importing",
    )
    parser.add_argument(
        "--api-url",
        default=None,
        help="Override API base URL (default: http://localhost:5000)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and save data but don't call the API",
    )
    parser.add_argument(
        "--city-boundary",
        choices=["auto", "on", "off"],
        default="auto",
        help=(
            "Filter address points to an Overture locality boundary. "
            "'auto' enables this for 7-digit place FIPS."
        ),
    )
    parser.add_argument(
        "--release",
        default=None,
        help="Overture release (default: STAC latest, or OVERTURE_RELEASE env)",
    )

    args = parser.parse_args()

    # Resolve the Overture release (STAC latest unless pinned) and repoint paths.
    _set_release(resolve_release(args.release))
    print(f"Overture release: {OVERTURE_RELEASE}")

    if args.api_url:
        global API_IMPORT_ENDPOINT
        API_IMPORT_ENDPOINT = f"{args.api_url}/v2/overture/import"

    # Get addresses
    if args.file:
        addresses = load_from_file(args.file)
        if args.limit:
            addresses = addresses[:args.limit]
    else:
        # Get bbox
        bbox = get_bbox_for_fips(args.fips, tuple(args.bbox) if args.bbox else None)
        if not bbox:
            print(f"ERROR: No bounding box for FIPS {args.fips}.")
            print(f"  Use --bbox XMIN YMIN XMAX YMAX or --file to provide data.")
            print(f"  Known FIPS codes: {', '.join(sorted(COUNTY_BBOXES.keys()))}")
            sys.exit(1)

        # Optional locality boundary filtering (for place FIPS)
        locality_names = None
        boundary_mode = args.city_boundary
        should_use_boundary = (
            boundary_mode == "on"
            or (boundary_mode == "auto" and len(args.fips) == 7)
        )

        if should_use_boundary:
            metadata = get_fips_metadata(args.fips)
            place = metadata.get("place")

            if place:
                locality_names = get_overture_locality_name_candidates(
                    place.get("name")
                )
            elif boundary_mode == "on":
                print(
                    f"ERROR: --city-boundary on requires a 7-digit place FIPS with known metadata. Got {args.fips}."
                )
                sys.exit(1)

        addresses = download_from_overture(
            args.fips,
            bbox,
            args.limit,
            locality_names=locality_names,
        )

    if not addresses:
        print("No addresses to import.")
        sys.exit(0)

    # Stats
    streets = set(a.get("street", "") for a in addresses if a.get("street"))
    print(f"\nData summary:")
    print(f"  Total addresses: {len(addresses):,}")
    print(f"  Unique streets:  {len(streets):,}")

    # Save to file if requested
    if args.save_json:
        with open(args.save_json, "w") as f:
            json.dump(addresses, f)
        print(f"  Saved to: {args.save_json}")

    # Import via API
    if args.dry_run:
        print("\n  --dry-run mode: skipping API import")
    else:
        send_to_api(args.fips, addresses, args.email)


if __name__ == "__main__":
    main()
