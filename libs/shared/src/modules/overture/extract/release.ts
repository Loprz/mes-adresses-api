/**
 * Overture release resolution.
 *
 * Node port of scripts/overture_release.py. Single source of truth for "which
 * Overture release are we importing?".
 *
 * Resolution order:
 *   1. An explicit value passed by the caller (e.g. from a query param).
 *   2. OVERTURE_RELEASE env var, if set to an explicit version (e.g. "2026-05-20.0").
 *   3. The STAC catalog's advertised latest release (https://stac.overturemaps.org/).
 *   4. A pinned fallback constant (used only when the catalog is unreachable).
 *
 * Set OVERTURE_RELEASE=latest (or leave it unset) to always track the newest
 * monthly release. Pin OVERTURE_RELEASE=YYYY-MM-DD.N to freeze for reproducibility.
 */

const STAC_CATALOG_URL = 'https://stac.overturemaps.org/';

// Fallback only — used when the STAC catalog cannot be reached. Keep this
// reasonably current, but the catalog is always preferred.
export const FALLBACK_RELEASE = '2026-05-20.0';

const RELEASE_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;

function looksLikeRelease(value: string | undefined | null): boolean {
  return Boolean(value && RELEASE_RE.test(value.trim()));
}

type StacLink = { rel?: string; href?: string; latest?: boolean };
type StacCatalog = { latest?: string; links?: StacLink[] };

async function fetchCatalog(timeoutMs = 15000): Promise<StacCatalog> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(STAC_CATALOG_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'nap-overture-loader',
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`STAC catalog HTTP ${resp.status}`);
    }
    return (await resp.json()) as StacCatalog;
  } finally {
    clearTimeout(timer);
  }
}

/** Return the latest release id from the STAC catalog, or null on failure. */
export async function fetchLatestRelease(timeoutMs = 15000): Promise<string | null> {
  let catalog: StacCatalog;
  try {
    catalog = await fetchCatalog(timeoutMs);
  } catch {
    return null;
  }

  // Preferred: top-level "latest" field.
  if (looksLikeRelease(catalog.latest)) {
    return catalog.latest!.trim();
  }

  // Fallback: scan child links for the one flagged latest, else newest id.
  const candidates: string[] = [];
  for (const link of catalog.links || []) {
    if (link.rel !== 'child') continue;
    const href = (link.href || '').replace(/^\.\//, '');
    const relId = href.split('/')[0];
    if (!looksLikeRelease(relId)) continue;
    if (link.latest) return relId;
    candidates.push(relId);
  }

  return candidates.length ? candidates.sort().reverse()[0] : null;
}

/**
 * Resolve the Overture release to use.
 *
 * @param explicit an override passed by the caller. Takes precedence over the
 *   env var unless it is null/undefined or "latest".
 */
export async function resolveRelease(explicit?: string | null): Promise<string> {
  const candidate =
    explicit !== undefined && explicit !== null
      ? explicit
      : process.env.OVERTURE_RELEASE;

  if (candidate && candidate.toLowerCase() !== 'latest') {
    return candidate.trim();
  }

  const latest = await fetchLatestRelease();
  if (latest) {
    return latest;
  }

  return FALLBACK_RELEASE;
}
