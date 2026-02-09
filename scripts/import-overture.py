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

Requirements:
    pip3 install duckdb requests
"""

import argparse
import json
import os
import sys
import time

# ──────────────────────────────────────────────────────────────────────────────
# Overture release and API configuration
# ──────────────────────────────────────────────────────────────────────────────

OVERTURE_RELEASE = "2026-01-21.0"
OVERTURE_S3_PATH = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=addresses/type=address/*"
API_BASE = os.environ.get("NAP_API_URL", "http://localhost:5050")
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


def download_from_overture(fips: str, bbox: tuple, limit: int | None = None) -> list:
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

    print("Querying Overture addresses...")
    t0 = time.time()

    result = con.execute(f"""
        SELECT id,
               ST_X(geometry) as longitude,
               ST_Y(geometry) as latitude,
               country, postcode, street, number, unit,
               postal_city,
               JSON(address_levels) as addr_levels,
               JSON(sources) as sources
        FROM read_parquet('{OVERTURE_S3_PATH}', filename=true, hive_partitioning=1)
        WHERE bbox.xmin > {xmin} AND bbox.xmax < {xmax}
          AND bbox.ymin > {ymin} AND bbox.ymax < {ymax}
          AND country = 'US'
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

    # For the first chunk, we create the LAB. For subsequent chunks,
    # we'd need a different strategy. For now, send all at once or in
    # one big batch — the API handles chunked DB inserts internally.
    payload = {
        "fipsCode": fips,
        "addresses": addresses,
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

    args = parser.parse_args()

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
        bbox = None
        if args.bbox:
            bbox = tuple(args.bbox)
        elif args.fips in COUNTY_BBOXES:
            bbox = COUNTY_BBOXES[args.fips]
        else:
            print(f"ERROR: No bounding box for FIPS {args.fips}.")
            print(f"  Use --bbox XMIN YMIN XMAX YMAX or --file to provide data.")
            print(f"  Known FIPS codes: {', '.join(sorted(COUNTY_BBOXES.keys()))}")
            sys.exit(1)

        addresses = download_from_overture(args.fips, bbox, args.limit)

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
