#!/usr/bin/env python3
"""
State-level bounding boxes (WGS84) for Overture spatial pre-filtering.

We filter Overture's address parquet to a single state bbox per scan, then
assign the exact county by ATTRIBUTE matching (see overture_fips.py). This is
why the loader needs only ~50 state bboxes instead of 3,000+ county bboxes:
the bbox is a coarse pre-filter, not the thing that decides the county.

Bboxes are intentionally slightly generous (they only pre-filter; over-inclusion
is corrected by the attribute matcher dropping out-of-state rows).
Format: fips -> (xmin, ymin, xmax, ymax)
"""

STATE_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "01": (-88.48, 30.14, -84.89, 35.01),   # Alabama
    "02": (-179.15, 51.00, 179.78, 71.45),  # Alaska
    "04": (-114.82, 31.33, -109.04, 37.01),  # Arizona
    "05": (-94.62, 33.00, -89.64, 36.50),   # Arkansas
    "06": (-124.48, 32.53, -114.13, 42.01),  # California
    "08": (-109.07, 36.99, -102.04, 41.01),  # Colorado
    "09": (-73.73, 40.95, -71.79, 42.05),   # Connecticut
    "10": (-75.79, 38.45, -75.05, 39.84),   # Delaware
    "11": (-77.12, 38.79, -76.91, 39.00),   # District of Columbia
    "12": (-87.63, 24.52, -80.03, 31.00),   # Florida
    "13": (-85.61, 30.36, -80.84, 35.00),   # Georgia
    "15": (-160.25, 18.91, -154.81, 22.24),  # Hawaii
    "16": (-117.24, 41.99, -111.04, 49.00),  # Idaho
    "17": (-91.51, 36.97, -87.02, 42.51),   # Illinois
    "18": (-88.10, 37.77, -84.78, 41.76),   # Indiana
    "19": (-96.64, 40.38, -90.14, 43.50),   # Iowa
    "20": (-102.05, 36.99, -94.59, 40.00),  # Kansas
    "21": (-89.57, 36.50, -81.96, 39.15),   # Kentucky
    "22": (-94.04, 28.93, -88.82, 33.02),   # Louisiana
    "23": (-71.08, 42.98, -66.95, 47.46),   # Maine
    "24": (-79.49, 37.91, -75.05, 39.72),   # Maryland
    "25": (-73.51, 41.24, -69.93, 42.89),   # Massachusetts
    "26": (-90.42, 41.70, -82.41, 48.31),   # Michigan
    "27": (-97.24, 43.50, -89.49, 49.38),   # Minnesota
    "28": (-91.66, 30.17, -88.10, 35.00),   # Mississippi
    "29": (-95.77, 35.99, -89.10, 40.61),   # Missouri
    "30": (-116.05, 44.36, -104.04, 49.00),  # Montana
    "31": (-104.05, 39.99, -95.31, 43.00),  # Nebraska
    "32": (-120.01, 35.00, -114.04, 42.00),  # Nevada
    "33": (-72.56, 42.70, -70.61, 45.31),   # New Hampshire
    "34": (-75.56, 38.93, -73.89, 41.36),   # New Jersey
    "35": (-109.05, 31.33, -103.00, 37.00),  # New Mexico
    "36": (-79.76, 40.50, -71.86, 45.02),   # New York
    "37": (-84.32, 33.84, -75.46, 36.59),   # North Carolina
    "38": (-104.05, 45.94, -96.55, 49.00),  # North Dakota
    "39": (-84.82, 38.40, -80.52, 42.32),   # Ohio
    "40": (-103.00, 33.62, -94.43, 37.00),  # Oklahoma
    "41": (-124.57, 41.99, -116.46, 46.29),  # Oregon
    "42": (-80.52, 39.72, -74.69, 42.27),   # Pennsylvania
    "44": (-71.91, 41.15, -71.12, 42.02),   # Rhode Island
    "45": (-83.35, 32.03, -78.54, 35.22),   # South Carolina
    "46": (-104.06, 42.48, -96.44, 45.95),  # South Dakota
    "47": (-90.31, 34.98, -81.65, 36.68),   # Tennessee
    "48": (-106.65, 25.84, -93.51, 36.50),  # Texas
    "49": (-114.05, 36.99, -109.04, 42.00),  # Utah
    "50": (-73.44, 42.73, -71.46, 45.02),   # Vermont
    "51": (-83.68, 36.54, -75.24, 39.47),   # Virginia
    "53": (-124.85, 45.54, -116.92, 49.00),  # Washington
    "54": (-82.64, 37.20, -77.72, 40.64),   # West Virginia
    "55": (-92.89, 42.49, -86.81, 47.31),   # Wisconsin
    "56": (-111.06, 40.99, -104.05, 45.01),  # Wyoming
    "72": (-67.95, 17.88, -65.22, 18.52),   # Puerto Rico
}

# State abbreviation -> state FIPS (for --state CA style input).
STATE_ABBR_TO_FIPS: dict[str, str] = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56", "PR": "72",
}


def resolve_state_fips(state: str) -> str | None:
    """Accept a 2-letter abbreviation or a 2-digit FIPS; return FIPS or None."""
    s = (state or "").strip().upper()
    if s in STATE_ABBR_TO_FIPS:
        return STATE_ABBR_TO_FIPS[s]
    if s.isdigit() and s.zfill(2) in STATE_BBOXES:
        return s.zfill(2)
    return None


def bbox_for_state_fips(state_fips: str) -> tuple[float, float, float, float] | None:
    return STATE_BBOXES.get(state_fips)
