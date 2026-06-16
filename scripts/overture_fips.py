#!/usr/bin/env python3
"""
County-FIPS attribute matcher for Overture address records.

Why attribute matching (not bounding boxes or spatial joins):
  - Bounding boxes don't scale: 3,000+ US counties would need a hand-maintained
    bbox table, and bboxes overlap so a point's bbox doesn't identify its county.
  - Overture US addresses carry up to three usable attribute signals:
      * sources[].dataset, e.g. "OpenAddresses/CA/Tulare County"  (tier 1)
      * address_levels = [{state}, {city}]                         (tier 2)
      * postcode (ZIP) + a ZIP->county crosswalk                   (tier 3)
    NOTE: US address_levels does NOT contain a county level, so we derive the
    county from the source-dataset string, falling back to a city->county
    crosswalk built from Census place FIPS.

Coverage note (matters for the national rollout):
  - OpenAddresses-sourced states (e.g. California) carry the county explicitly
    in sources[].dataset -> tier 1 matches ~100% with no extra data.
  - NAD-sourced data (National Address Database; e.g. much of Texas) has
    dataset="NAD" and a null city, so tiers 1 and 2 both miss. Those rows
    need the ZIP crosswalk (tier 3) or a spatial point-in-county fallback.
    Tier 3 activates only when a crosswalk file is supplied; see
    `CountyMatcher.from_file(zip_crosswalk_path=...)`. ZIP->county is
    approximate at county boundaries (a ZIP can span counties); for exact
    assignment in NAD states, add a spatial fallback.

Everything else is driven by us-fips-data.json, so the same matcher works for
any state/county in the country with no per-jurisdiction configuration.
"""

import json
import os
import re

_SUFFIX_RE = re.compile(
    r"\s+(county|parish|borough|census area|city and borough|municipality|"
    r"municipio)$",
    re.IGNORECASE,
)
_PLACE_TYPE_RE = re.compile(
    r"\s+(city|town|village|borough|township|municipality|municipio|cdp|"
    r"comunidad|zona urbana)$",
    re.IGNORECASE,
)
# "OpenAddresses/CA/Tulare County" -> ("CA", "Tulare County")
_SOURCE_RE = re.compile(r"^[^/]+/([A-Za-z]{2})/(.+?)\s*$")


def _norm_county(name: str) -> str:
    name = (name or "").strip()
    # strip a trailing administrative suffix, possibly repeated
    prev = None
    while prev != name:
        prev = name
        name = _SUFFIX_RE.sub("", name).strip()
    return re.sub(r"\s+", " ", name).lower()


def _norm_place(name: str) -> str:
    name = (name or "").strip()
    prev = None
    while prev != name:
        prev = name
        name = _PLACE_TYPE_RE.sub("", name).strip()
    return re.sub(r"\s+", " ", name).lower()


class CountyMatcher:
    """Resolves Overture address attributes to a 5-digit county FIPS."""

    def __init__(self, fips_data: dict, zip_crosswalk: dict | None = None):
        self._county_index: dict[tuple[str, str], str] = {}
        self._place_index: dict[tuple[str, str], str | None] = {}
        # zip5 -> county_fips (5-digit). Optional; powers tier 3.
        self._zip_index: dict[str, str] = {
            str(z).zfill(5): str(c)
            for z, c in (zip_crosswalk or {}).items()
            if z and c
        }

        for code, c in fips_data.get("counties", {}).items():
            st = (c.get("stateAbbr") or "").upper()
            key = (st, _norm_county(c.get("name", "")))
            if st and key[1]:
                self._county_index[key] = code

        # City -> county. If the same (state, normalized-name) maps to more than
        # one county, mark it ambiguous (None) so we never guess wrong.
        for p in fips_data.get("places", {}).values():
            st = (p.get("stateAbbr") or "").upper()
            county_fips = p.get("countyFips")
            if not st or not county_fips:
                continue
            key = (st, _norm_place(p.get("name", "")))
            if not key[1]:
                continue
            if key in self._place_index and self._place_index[key] != county_fips:
                self._place_index[key] = None  # ambiguous
            elif key not in self._place_index:
                self._place_index[key] = county_fips

    @classmethod
    def from_file(
        cls,
        path: str | None = None,
        zip_crosswalk_path: str | None = None,
    ) -> "CountyMatcher":
        if path is None:
            here = os.path.dirname(os.path.abspath(__file__))
            path = os.path.normpath(os.path.join(here, "..", "us-fips-data.json"))
        with open(path, "r") as f:
            fips_data = json.load(f)
        # Optional ZIP->county crosswalk (tier 3). Accepts {zip: countyFips} or
        # {zip: {countyFips: ...}}. Supply a Census ZCTA->county relationship
        # file converted to this shape for NAD-sourced states.
        zx = None
        zx_path = zip_crosswalk_path or os.environ.get("ZIP_COUNTY_CROSSWALK")
        if zx_path and os.path.exists(zx_path):
            with open(zx_path, "r") as f:
                raw = json.load(f)
            zx = {
                z: (v if isinstance(v, str) else v.get("countyFips"))
                for z, v in raw.items()
            }
        return cls(fips_data, zip_crosswalk=zx)

    def from_source_dataset(self, dataset: str | None) -> str | None:
        if not dataset:
            return None
        m = _SOURCE_RE.match(dataset.strip())
        if not m:
            return None
        st, county_part = m.group(1).upper(), m.group(2)
        return self._county_index.get((st, _norm_county(county_part)))

    def from_city(self, state_abbr: str | None, city: str | None) -> str | None:
        if not state_abbr or not city:
            return None
        return self._place_index.get(((state_abbr or "").upper(), _norm_place(city)))

    def from_zip(self, postcode: str | None) -> str | None:
        if not postcode or not self._zip_index:
            return None
        return self._zip_index.get(str(postcode).strip()[:5].zfill(5))

    def match(self, record: dict) -> tuple[str | None, str]:
        """
        Returns (county_fips, method) where method is one of:
          "source"  -> matched from sources[].dataset
          "city"    -> matched from city + state crosswalk
          "zip"     -> matched from postcode + ZIP->county crosswalk
          "none"    -> unmatched
        `record` uses the importer's normalized shape:
          { addressLevels: [{value: state}, {value: city}],
            sources: [{dataset}], postcode }
        """
        levels = record.get("addressLevels") or []
        state_abbr = levels[0].get("value") if len(levels) >= 1 else None
        city = levels[1].get("value") if len(levels) >= 2 else None

        # Tier 1: source-dataset string (carries the county explicitly).
        for src in record.get("sources") or []:
            fips = self.from_source_dataset(src.get("dataset"))
            if fips:
                return fips, "source"

        # Tier 2: city -> county crosswalk.
        fips = self.from_city(state_abbr, city)
        if fips:
            return fips, "city"

        # Tier 3: ZIP -> county crosswalk (NAD-sourced data). Optional.
        fips = self.from_zip(record.get("postcode"))
        if fips:
            return fips, "zip"

        return None, "none"


if __name__ == "__main__":
    # Tiny self-test against the bundled FIPS data.
    m = CountyMatcher.from_file()
    samples = [
        {"addressLevels": [{"value": "CA"}, {"value": "Lindsay"}],
         "sources": [{"dataset": "OpenAddresses/CA/Tulare County"}]},
        {"addressLevels": [{"value": "CA"}, {"value": "Fresno"}],
         "sources": [{"dataset": "OpenAddresses/CA/Fresno County"}]},
        {"addressLevels": [{"value": "CA"}, {"value": "Lindsay"}],
         "sources": [{"dataset": "SomeOtherSource"}]},  # city fallback
        {"addressLevels": [{"value": "CA"}, {"value": "Nowhereville"}],
         "sources": []},  # unmatched
    ]
    for s in samples:
        print(m.match(s), "<-", s["sources"], s["addressLevels"][1])
