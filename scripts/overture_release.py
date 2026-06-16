#!/usr/bin/env python3
"""
Overture release resolution.

Single source of truth for "which Overture release are we importing?".

Resolution order:
  1. OVERTURE_RELEASE env var, if set to an explicit version (e.g. "2026-05-20.0").
  2. The STAC catalog's advertised latest release (https://stac.overturemaps.org/).
  3. A pinned fallback constant (used only when the catalog is unreachable).

Set OVERTURE_RELEASE=latest (or leave it unset) to always track the newest
monthly release. Pin OVERTURE_RELEASE=YYYY-MM-DD.N to freeze a run for
reproducibility.

Usage:
    from overture_release import resolve_release
    release = resolve_release()        # -> "2026-05-20.0"

    # CLI:
    python3 scripts/overture_release.py            # prints resolved release
    python3 scripts/overture_release.py --list     # prints all known releases
"""

import json
import os
import sys
import urllib.request

STAC_CATALOG_URL = "https://stac.overturemaps.org/"

# Fallback only — used when the STAC catalog cannot be reached. Keep this
# reasonably current, but the catalog is always preferred.
FALLBACK_RELEASE = "2026-05-20.0"

_RELEASE_RE = None  # lazy


def _looks_like_release(value: str) -> bool:
    """Cheap shape check: YYYY-MM-DD.N (e.g. 2026-05-20.0)."""
    global _RELEASE_RE
    if _RELEASE_RE is None:
        import re

        _RELEASE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")
    return bool(value and _RELEASE_RE.match(value.strip()))


def _fetch_catalog(timeout: float = 15.0) -> dict:
    req = urllib.request.Request(
        STAC_CATALOG_URL,
        headers={"Accept": "application/json", "User-Agent": "nap-overture-loader"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_latest_release(timeout: float = 15.0) -> str | None:
    """Return the latest release id from the STAC catalog, or None on failure."""
    try:
        catalog = _fetch_catalog(timeout=timeout)
    except Exception as exc:  # network, JSON, etc. — caller decides fallback
        print(f"  [release] STAC catalog unreachable: {exc}", file=sys.stderr)
        return None

    # Preferred: top-level "latest" field.
    latest = catalog.get("latest")
    if _looks_like_release(latest or ""):
        return latest.strip()

    # Fallback: scan child links for the one flagged latest, else newest id.
    candidates = []
    for link in catalog.get("links", []):
        if link.get("rel") != "child":
            continue
        # href like "./2026-05-20.0/catalog.json"
        href = (link.get("href") or "").strip("./")
        rel_id = href.split("/")[0]
        if not _looks_like_release(rel_id):
            continue
        if link.get("latest"):
            return rel_id
        candidates.append(rel_id)

    return max(candidates) if candidates else None


def list_releases(timeout: float = 15.0) -> list[str]:
    """Return all release ids advertised by the catalog, newest first."""
    try:
        catalog = _fetch_catalog(timeout=timeout)
    except Exception:
        return []
    out = []
    for link in catalog.get("links", []):
        if link.get("rel") != "child":
            continue
        rel_id = (link.get("href") or "").strip("./").split("/")[0]
        if _looks_like_release(rel_id):
            out.append(rel_id)
    return sorted(set(out), reverse=True)


def resolve_release(explicit: str | None = None) -> str:
    """
    Resolve the Overture release to use.

    explicit: an override passed by the caller (e.g. from --release). Takes
              precedence over the env var unless it is None or "latest".
    """
    candidate = explicit if explicit is not None else os.environ.get("OVERTURE_RELEASE")

    if candidate and candidate.lower() != "latest":
        if not _looks_like_release(candidate):
            print(
                f"  [release] WARNING: '{candidate}' is not a YYYY-MM-DD.N release id; "
                "using it anyway.",
                file=sys.stderr,
            )
        return candidate.strip()

    latest = fetch_latest_release()
    if latest:
        print(f"  [release] resolved latest from STAC: {latest}")
        return latest

    print(
        f"  [release] falling back to pinned release: {FALLBACK_RELEASE}",
        file=sys.stderr,
    )
    return FALLBACK_RELEASE


if __name__ == "__main__":
    if "--list" in sys.argv:
        for r in list_releases():
            print(r)
    else:
        print(resolve_release())
