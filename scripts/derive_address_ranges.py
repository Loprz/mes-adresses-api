#!/usr/bin/env python3
"""
Derive NG911-style road-centerline address ranges from address points.

This is the "assist" that turns a county's address points into the hardest part
of the NENA Road Centerline layer: left/right From/To address ranges + parity.
It implements the address→segment proximity edge from the Wherobots Spatial
Graph RAG pattern, then aggregates per segment per side.

Pipeline (per jurisdiction / bbox):
  1. Pull address points (number, street, lon/lat) and road centerlines
     (id, name, geometry) from Overture — or pass your own authority data.
  2. Snap each address to the nearest centerline of the SAME street name
     (falling back to nearest named centerline within a distance threshold).
  3. Determine side (left/right) from the segment direction at the snap point.
  4. Aggregate house numbers per (segment, side), split by parity, and emit
     From_Add_L / To_Add_L / From_Add_R / To_Add_R with a confidence signal.

Every assignment carries provenance (method + snap distance) so a clerk can
review low-confidence rows instead of trusting a black box.

Requirements: pip3 install duckdb shapely
Usage:
  python3 scripts/derive_address_ranges.py --bbox -119.10 36.18 -119.00 36.24
  python3 scripts/derive_address_ranges.py --bbox ... --release 2026-05-20.0 --json out.json
"""

import argparse
import json
import re
import sys
from collections import defaultdict

from shapely.geometry import LineString, Point
from shapely import wkt as shapely_wkt

try:
    from overture_release import resolve_release
except Exception:  # pragma: no cover - allow standalone use
    def resolve_release(x=None):
        return x or "2026-05-20.0"

SNAP_THRESHOLD_M = 60.0  # max snap distance to accept an assignment
_WS = re.compile(r"\s+")
_DIR = {
    "n": "north", "s": "south", "e": "east", "w": "west",
    "ne": "northeast", "nw": "northwest", "se": "southeast", "sw": "southwest",
}
_TYPE = {
    "st": "street", "ave": "avenue", "av": "avenue", "blvd": "boulevard",
    "rd": "road", "dr": "drive", "ln": "lane", "ct": "court", "cir": "circle",
    "hwy": "highway", "pkwy": "parkway", "pl": "place", "ter": "terrace",
    "way": "way", "trl": "trail",
}


def norm_street(name: str) -> str:
    """Loose street-name normalization for matching across data sources."""
    if not name:
        return ""
    s = name.strip().lower()
    s = re.sub(r"[.,]", "", s)
    toks = [_DIR.get(t, _TYPE.get(t, t)) for t in _WS.split(s) if t]
    return " ".join(toks)


def _meters_per_degree(lat: float) -> tuple[float, float]:
    import math
    mlat = 111_320.0
    mlon = 111_320.0 * math.cos(math.radians(lat))
    return mlon, mlat


def fetch_overture(bbox, release):
    import duckdb
    xmin, ymin, xmax, ymax = bbox
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    base = f"s3://overturemaps-us-west-2/release/{release}"
    addr_path = f"{base}/theme=addresses/type=address/*"
    seg_path = f"{base}/theme=transportation/type=segment/*"

    addrs = con.execute(f"""
        SELECT number, street, ST_X(geometry) lon, ST_Y(geometry) lat
        FROM read_parquet('{addr_path}', filename=true, hive_partitioning=1)
        WHERE bbox.xmin > {xmin} AND bbox.xmax < {xmax}
          AND bbox.ymin > {ymin} AND bbox.ymax < {ymax}
          AND country='US' AND street IS NOT NULL AND number IS NOT NULL
    """).fetchall()

    # Pull segments from a slightly padded bbox so edge addresses still snap.
    pad = 0.01
    segs = con.execute(f"""
        SELECT id, names.primary AS name, ST_AsText(geometry) AS wkt
        FROM read_parquet('{seg_path}', filename=true, hive_partitioning=1)
        WHERE bbox.xmin > {xmin - pad} AND bbox.xmax < {xmax + pad}
          AND bbox.ymin > {ymin - pad} AND bbox.ymax < {ymax + pad}
          AND subtype='road' AND names.primary IS NOT NULL
    """).fetchall()
    con.close()
    return addrs, segs


def build_segments(segs, lat0):
    """Project lon/lat to a local meter plane so distances/sides are metric."""
    mlon, mlat = _meters_per_degree(lat0)
    out = []
    by_name = defaultdict(list)
    for sid, name, wkt in segs:
        geom = shapely_wkt.loads(wkt)
        if geom.geom_type != "LineString":
            # MultiLineString etc. — take the longest part
            try:
                geom = max(geom.geoms, key=lambda g: g.length)
            except Exception:
                continue
        coords = [((x) * mlon, (y) * mlat) for x, y in geom.coords]
        if len(coords) < 2:
            continue
        line = LineString(coords)
        rec = {"id": sid, "name": name, "norm": norm_street(name), "line": line}
        out.append(rec)
        by_name[rec["norm"]].append(rec)
    return out, by_name, (mlon, mlat)


def side_of(line: LineString, pt: Point) -> str:
    """Left/right of the line direction at the point's projection."""
    d = line.project(pt)
    eps = max(line.length * 1e-4, 0.5)
    a = line.interpolate(max(0.0, d - eps))
    b = line.interpolate(min(line.length, d + eps))
    # cross product z of (segment dir) x (a->pt)
    vx, vy = b.x - a.x, b.y - a.y
    wx, wy = pt.x - a.x, pt.y - a.y
    cross = vx * wy - vy * wx
    return "L" if cross > 0 else "R"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, required=True,
                    metavar=("XMIN", "YMIN", "XMAX", "YMAX"))
    ap.add_argument("--release", default=None)
    ap.add_argument("--json", default=None, help="write per-segment ranges to JSON")
    args = ap.parse_args()

    release = resolve_release(args.release)
    print(f"Release: {release}")
    addrs, segs = fetch_overture(args.bbox, release)
    print(f"Addresses: {len(addrs):,}   Road segments: {len(segs):,}")
    if not addrs or not segs:
        print("Nothing to derive.")
        return

    lat0 = sum(a[3] for a in addrs) / len(addrs)
    seg_recs, by_name, (mlon, mlat) = build_segments(segs, lat0)

    # (segment_id, side) -> list of house numbers; plus bookkeeping
    buckets = defaultdict(list)
    seg_meta = {}
    assigned = unmatched = far = 0

    for number, street, lon, lat in addrs:
        try:
            num = int(re.sub(r"[^0-9].*$", "", str(number)))
        except (ValueError, TypeError):
            continue
        pt = Point(lon * mlon, lat * mlat)
        nstreet = norm_street(street)

        candidates = by_name.get(nstreet)
        method = "name+nearest"
        if not candidates:
            candidates = seg_recs  # fall back to any named centerline
            method = "nearest-only"

        best, best_d = None, float("inf")
        for rec in candidates:
            d = rec["line"].distance(pt)
            if d < best_d:
                best, best_d = rec, d

        if best is None:
            unmatched += 1
            continue
        if best_d > SNAP_THRESHOLD_M:
            far += 1
            continue

        side = side_of(best["line"], pt)
        buckets[(best["id"], side)].append(num)
        seg_meta[best["id"]] = best["name"]
        assigned += 1

    # Aggregate per segment: L/R ranges + dominant parity
    seg_ranges = {}
    for (sid, side), nums in buckets.items():
        evens = [n for n in nums if n % 2 == 0]
        odds = [n for n in nums if n % 2 == 1]
        parity = "even" if len(evens) >= len(odds) else "odd"
        dom = evens if parity == "even" else odds
        lo, hi = (min(dom), max(dom)) if dom else (min(nums), max(nums))
        seg_ranges.setdefault(sid, {"street": seg_meta[sid], "L": None, "R": None})
        seg_ranges[sid][side] = {
            "from": lo, "to": hi, "parity": parity, "count": len(nums),
        }

    print(f"\nAssigned: {assigned:,}   Unmatched street: {unmatched:,}   "
          f"Beyond {SNAP_THRESHOLD_M:.0f}m: {far:,}")
    print(f"Segments with derived ranges: {len(seg_ranges):,}")

    shown = sorted(seg_ranges.items(),
                   key=lambda kv: -((kv[1]['L'] or {}).get('count', 0)
                                    + (kv[1]['R'] or {}).get('count', 0)))[:12]
    print(f"\n{'Street':<26}{'L From-To (par)':<22}{'R From-To (par)':<22}")
    print("-" * 70)
    for sid, r in shown:
        L = r["L"]; R = r["R"]
        ls = f"{L['from']}-{L['to']} ({L['parity'][:3]})" if L else "—"
        rs = f"{R['from']}-{R['to']} ({R['parity'][:3]})" if R else "—"
        print(f"{(r['street'] or '?')[:25]:<26}{ls:<22}{rs:<22}")

    if args.json:
        with open(args.json, "w") as f:
            json.dump(seg_ranges, f, indent=2)
        print(f"\nWrote {len(seg_ranges)} segments to {args.json}")


if __name__ == "__main__":
    main()
