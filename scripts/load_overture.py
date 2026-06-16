#!/usr/bin/env python3
"""
Overture -> National Address Platform loader (US-scalable).

This is the go-forward loader. It is designed so the same code path runs for a
single county, a whole state, or eventually the whole country:

  * Release: resolved from the Overture STAC catalog (latest) unless pinned.
  * Spatial pre-filter: ONE scan per state bbox (not per county).
  * County assignment: ATTRIBUTE matching (source dataset -> city -> ZIP),
    so no per-county bounding boxes and no spatial join are required.
  * Import: chunked + append, so arbitrarily large counties (e.g. Los Angeles)
    load across multiple POSTs into a single LAB.
  * Idempotency: skips counties already imported for the same release.

Examples
--------
# Dry run: scan California once, report addresses per county for the latest release
python3 scripts/load_overture.py --state CA --dry-run

# Load every California county into the API (chunked + append, skip already-imported)
python3 scripts/load_overture.py --state CA --skip-existing

# Load a subset of counties
python3 scripts/load_overture.py --state CA --counties 06019,06107

# Single county (state bbox is used as the pre-filter, then attribute-matched)
python3 scripts/load_overture.py --fips 06037

# Pin a release for reproducibility
python3 scripts/load_overture.py --state CA --release 2026-05-20.0 --dry-run

Requirements: pip3 install duckdb requests
"""

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict

from overture_release import resolve_release
from overture_fips import CountyMatcher
from state_bboxes import resolve_state_fips, bbox_for_state_fips

API_BASE = os.environ.get("NAP_API_URL", "http://localhost:5050")


def _s3_addresses_path(release: str) -> str:
    return (
        f"s3://overturemaps-us-west-2/release/{release}"
        f"/theme=addresses/type=address/*"
    )


def scan_state(release: str, state_fips: str, limit: int | None = None) -> list[dict]:
    """One DuckDB scan over a state's bbox; returns normalized address records."""
    try:
        import duckdb
    except ImportError:
        print("ERROR: duckdb not installed. Run: pip3 install duckdb")
        sys.exit(1)

    bbox = bbox_for_state_fips(state_fips)
    if not bbox:
        print(f"ERROR: no bbox for state FIPS {state_fips}")
        sys.exit(1)
    xmin, ymin, xmax, ymax = bbox

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")

    limit_clause = f"LIMIT {limit}" if limit else ""
    print(f"  Scanning Overture {release} for state {state_fips} bbox {bbox} ...")
    t0 = time.time()
    rows = con.execute(f"""
        SELECT id,
               ST_X(geometry) AS longitude,
               ST_Y(geometry) AS latitude,
               country, postcode, street, number, unit,
               postal_city,
               JSON(address_levels) AS addr_levels,
               JSON(sources) AS sources
        FROM read_parquet('{_s3_addresses_path(release)}',
                          filename=true, hive_partitioning=1)
        WHERE bbox.xmin > {xmin} AND bbox.xmax < {xmax}
          AND bbox.ymin > {ymin} AND bbox.ymax < {ymax}
          AND country = 'US'
        {limit_clause}
    """).fetchall()
    con.close()
    print(f"  Fetched {len(rows):,} rows in {time.time() - t0:.1f}s")

    out = []
    for r in rows:
        out.append({
            "gersId": r[0],
            "longitude": r[1],
            "latitude": r[2],
            "country": r[3],
            "postcode": r[4],
            "street": r[5],
            "number": r[6],
            "unit": r[7],
            "postalCity": r[8],
            "addressLevels": json.loads(r[9]) if r[9] else [],
            "sources": json.loads(r[10]) if r[10] else [],
        })
    return out


def group_by_county(
    records: list[dict],
    matcher: CountyMatcher,
    state_fips: str | None = None,
) -> tuple[dict[str, list[dict]], Counter, int]:
    """
    Returns (county_fips -> records, method_counter, unmatched_count).
    Rows whose matched county is outside `state_fips` (bbox spillover) are
    treated as unmatched for this state's run.
    """
    buckets: dict[str, list[dict]] = defaultdict(list)
    methods: Counter = Counter()
    unmatched = 0
    for rec in records:
        fips, method = matcher.match(rec)
        if fips and state_fips and not fips.startswith(state_fips):
            fips, method = None, "out_of_state"
        methods[method] += 1
        if fips:
            buckets[fips].append(rec)
        else:
            unmatched += 1
    return dict(buckets), methods, unmatched


# ─────────────────────────────── API client ────────────────────────────────

def _api_url(path: str) -> str:
    return f"{API_BASE.rstrip('/')}/v2/overture{path}"


def lookup_existing(fips: str, release: str) -> dict | None:
    """Return {balId, token, addressCount} if this (fips, release) was imported."""
    import requests

    try:
        resp = requests.get(
            _api_url("/lab"),
            params={"fips": fips, "release": release},
            timeout=30,
        )
    except requests.RequestException:
        return None
    if resp.status_code == 200:
        data = resp.json()
        return data if data and data.get("balId") else None
    return None


def import_county(
    fips: str,
    records: list[dict],
    release: str,
    email: str | None,
    chunk_size: int,
) -> dict:
    """Create a LAB for the county and append all records in chunks."""
    import requests

    total = len(records)
    bal_id = None
    token = None
    created = 0
    streets = 0
    gers = 0
    skipped = 0
    t0 = time.time()

    for i in range(0, total, chunk_size):
        chunk = records[i:i + chunk_size]
        append = bal_id is not None
        payload = {
            "fipsCode": fips,
            "addresses": chunk,
            "release": release,
            "append": append,
        }
        if append:
            payload["balId"] = bal_id
            payload["token"] = token
        elif email:
            payload["email"] = email

        resp = requests.post(
            _api_url("/import"),
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=900,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"chunk {i // chunk_size} failed ({resp.status_code}): "
                f"{resp.text[:300]}"
            )
        res = resp.json()
        bal_id = bal_id or res.get("balId")
        token = token or res.get("token")
        created += res.get("addressesCreated", 0)
        streets += res.get("streetsCreated", 0)
        gers += res.get("gersIdsLinked", 0)
        skipped += res.get("skipped", 0)
        done = min(i + chunk_size, total)
        print(f"      chunk {i // chunk_size + 1}: {done:,}/{total:,} "
              f"(+{res.get('addressesCreated', 0):,} addr)")

    return {
        "balId": bal_id,
        "token": token,
        "addressesCreated": created,
        "streetsCreated": streets,
        "gersIdsLinked": gers,
        "skipped": skipped,
        "durationMs": int((time.time() - t0) * 1000),
    }


# ──────────────────────────────────── main ─────────────────────────────────

def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--state", help="State to load (abbreviation or 2-digit FIPS), e.g. CA")
    g.add_argument("--fips", help="Single 5-digit county FIPS, e.g. 06037")
    p.add_argument("--release", default=None,
                   help="Overture release (default: STAC latest; or set OVERTURE_RELEASE)")
    p.add_argument("--counties", default=None,
                   help="Comma-separated county FIPS filter (subset of the state)")
    p.add_argument("--limit", type=int, default=None,
                   help="Max rows to scan (testing)")
    p.add_argument("--chunk-size", type=int, default=25000,
                   help="Addresses per POST (keeps payload under the API body limit)")
    p.add_argument("--email", default=None, help="Admin email for created LABs")
    p.add_argument("--api-url", default=None, help="Override API base URL")
    p.add_argument("--skip-existing", action="store_true",
                   help="Skip counties already imported for this release")
    p.add_argument("--dry-run", action="store_true",
                   help="Scan and report per-county counts; do not import")
    p.add_argument("--save-json", default=None,
                   help="Write the grouped {fips: [records]} to a JSON file")
    args = p.parse_args()

    if args.api_url:
        global API_BASE
        API_BASE = args.api_url

    release = resolve_release(args.release)
    matcher = CountyMatcher.from_file()

    # Determine the state to scan and an optional county filter.
    if args.state:
        state_fips = resolve_state_fips(args.state)
        if not state_fips:
            print(f"ERROR: unknown state '{args.state}'")
            sys.exit(1)
        county_filter = (
            {c.strip() for c in args.counties.split(",")} if args.counties else None
        )
    else:  # --fips
        fips = args.fips.strip()
        if len(fips) != 5:
            print("ERROR: --fips must be a 5-digit county FIPS")
            sys.exit(1)
        state_fips = fips[:2]
        county_filter = {fips}

    print(f"\nRelease:    {release}")
    print(f"State FIPS:  {state_fips}")
    if county_filter:
        print(f"Counties:   {', '.join(sorted(county_filter))}")

    records = scan_state(release, state_fips, limit=args.limit)
    buckets, methods, unmatched = group_by_county(records, matcher, state_fips)

    if county_filter:
        buckets = {f: r for f, r in buckets.items() if f in county_filter}

    # ── Report ──────────────────────────────────────────────────────────────
    print(f"\nMatch methods: {dict(methods)}")
    print(f"Unmatched rows (no county): {unmatched:,}")
    print(f"Counties with data: {len(buckets)}")
    fips_data = json.load(open(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "us-fips-data.json")
    ))
    county_names = {k: v.get("name") for k, v in fips_data.get("counties", {}).items()}
    print(f"\n{'FIPS':<8}{'County':<28}{'Addresses':>12}")
    print("-" * 48)
    for fips in sorted(buckets, key=lambda f: -len(buckets[f])):
        print(f"{fips:<8}{(county_names.get(fips) or '?'):<28}{len(buckets[fips]):>12,}")

    if args.save_json:
        with open(args.save_json, "w") as f:
            json.dump(buckets, f)
        print(f"\nSaved grouped records to {args.save_json}")

    if args.dry_run:
        print("\n--dry-run: no data imported.")
        return

    # ── Import ──────────────────────────────────────────────────────────────
    print(f"\nImporting into {API_BASE} (chunk size {args.chunk_size:,})...")
    summary = []
    for fips in sorted(buckets, key=lambda f: -len(buckets[f])):
        name = county_names.get(fips) or fips
        recs = buckets[fips]
        if args.skip_existing:
            existing = lookup_existing(fips, release)
            if existing:
                print(f"  - {name} ({fips}): already imported "
                      f"(LAB {existing['balId']}), skipping")
                summary.append((fips, name, "skipped", 0))
                continue
        print(f"  - {name} ({fips}): {len(recs):,} addresses")
        try:
            res = import_county(fips, recs, release, args.email, args.chunk_size)
            print(f"      done: LAB {res['balId']} "
                  f"({res['addressesCreated']:,} addr, {res['streetsCreated']:,} streets)")
            summary.append((fips, name, "ok", res["addressesCreated"]))
        except Exception as exc:
            print(f"      ERROR: {exc}")
            summary.append((fips, name, "error", 0))

    ok = sum(1 for _, _, s, _ in summary if s == "ok")
    print(f"\nDone. {ok}/{len(summary)} counties imported "
          f"({sum(n for _, _, _, n in summary):,} addresses).")


if __name__ == "__main__":
    main()
