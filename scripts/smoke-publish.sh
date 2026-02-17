#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5050/v2}"
DEPOT_BASE="${DEPOT_BASE:-http://localhost:4242}"
COMMUNE="${COMMUNE:-06037}"
BAL_NAME="${BAL_NAME:-Smoke Publish $(date +%s)}"
SEED_EMAIL="${SEED_EMAIL:-smoke@example.com}"
PIN_DB_URL="${PIN_DB_URL:-${POSTGRES_URL:-}}"
EMAIL="${EMAIL:-}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd node

if [ -z "${PIN_DB_URL}" ]; then
  echo "PIN_DB_URL (or POSTGRES_URL) is required to read the sent PIN code." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "Creating BAL in commune ${COMMUNE}..."
create_payload="$(jq -n \
  --arg nom "${BAL_NAME}" \
  --arg email "${SEED_EMAIL}" \
  --arg commune "${COMMUNE}" \
  '{nom: $nom, emails: [$email], commune: $commune}')"
create_status="$(curl -sS -o "${tmp_dir}/create.json" -w "%{http_code}" \
  -X POST "${API_BASE}/bases-locales" \
  -H 'content-type: application/json' \
  -d "${create_payload}")"
[ "${create_status}" = "200" ] || {
  cat "${tmp_dir}/create.json" >&2
  exit 1
}

BAL_ID="$(jq -r '.id' "${tmp_dir}/create.json")"
TOKEN="$(jq -r '.token' "${tmp_dir}/create.json")"
AUTH_HEADER="Authorization: Bearer ${TOKEN}"
echo "BAL_ID=${BAL_ID}"

echo "Creating voie..."
voie_status="$(curl -sS -o "${tmp_dir}/voie.json" -w "%{http_code}" \
  -X POST "${API_BASE}/bases-locales/${BAL_ID}/voies" \
  -H "${AUTH_HEADER}" \
  -H 'content-type: application/json' \
  -d '{"nom":"Main St"}')"
[ "${voie_status}" = "201" ] || {
  cat "${tmp_dir}/voie.json" >&2
  exit 1
}
VOIE_ID="$(jq -r '.id' "${tmp_dir}/voie.json")"
echo "VOIE_ID=${VOIE_ID}"

echo "Creating numero..."
numero_status="$(curl -sS -o "${tmp_dir}/numero.json" -w "%{http_code}" \
  -X POST "${API_BASE}/voies/${VOIE_ID}/numeros" \
  -H "${AUTH_HEADER}" \
  -H 'content-type: application/json' \
  -d '{"numero":123,"positions":[{"type":"entrée","source":"smoke-test","point":{"type":"Point","coordinates":[-118.24368,34.05223]}}]}')"
[ "${numero_status}" = "201" ] || {
  cat "${tmp_dir}/numero.json" >&2
  exit 1
}

echo "Creating habilitation..."
habilitation_status="$(curl -sS -o "${tmp_dir}/habilitation.json" -w "%{http_code}" \
  -X POST "${API_BASE}/bases-locales/${BAL_ID}/habilitation" \
  -H "${AUTH_HEADER}")"
[ "${habilitation_status}" = "201" ] || {
  cat "${tmp_dir}/habilitation.json" >&2
  exit 1
}

if [ -z "${EMAIL}" ]; then
  emails_status="$(curl -sS -o "${tmp_dir}/emails.json" -w "%{http_code}" \
    -X GET "${API_BASE}/bases-locales/${BAL_ID}/habilitation/emails" \
    -H "${AUTH_HEADER}")"
  [ "${emails_status}" = "200" ] || {
    cat "${tmp_dir}/emails.json" >&2
    exit 1
  }
  EMAIL="$(jq -r '.[0] // empty' "${tmp_dir}/emails.json")"
fi

if [ -z "${EMAIL}" ]; then
  echo "Unable to determine registered jurisdiction email for commune ${COMMUNE}" >&2
  exit 1
fi

echo "Sending PIN code to ${EMAIL}..."
send_pin_payload="$(jq -n --arg email "${EMAIL}" '{email: $email}')"
send_pin_status="$(curl -sS -o "${tmp_dir}/send-pin.json" -w "%{http_code}" \
  -X POST "${API_BASE}/bases-locales/${BAL_ID}/habilitation/email/send-pin-code" \
  -H "${AUTH_HEADER}" \
  -H 'content-type: application/json' \
  -d "${send_pin_payload}")"
[ "${send_pin_status}" = "200" ] || {
  cat "${tmp_dir}/send-pin.json" >&2
  exit 1
}

# For automated smoke tests we read the freshly generated PIN directly from DB.
PIN="$(BAL_ID="${BAL_ID}" PIN_DB_URL="${PIN_DB_URL}" node <<'NODE'
const {Client} = require('pg');

const balId = process.env.BAL_ID;
const connectionString = process.env.PIN_DB_URL;
const needsSsl =
  !connectionString.includes('railway.internal') &&
  !connectionString.includes('localhost') &&
  !connectionString.includes('127.0.0.1');

(async () => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
    ssl: needsSsl ? {rejectUnauthorized: false} : undefined,
  });

  await client.connect();
  const result = await client.query(
    "SELECT strategy->>'pinCode' AS pin FROM habilitations WHERE bal_id = $1 ORDER BY created_at DESC LIMIT 1",
    [balId]
  );
  await client.end();

  process.stdout.write(result.rows[0]?.pin || '');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
)"

if [ -z "${PIN}" ]; then
  echo "Unable to read PIN code from DB for BAL ${BAL_ID}" >&2
  exit 1
fi

echo "Validating PIN code..."
validate_pin_payload="$(jq -n --arg code "${PIN}" '{code: $code}')"
validate_pin_status="$(curl -sS -o "${tmp_dir}/validate-pin.json" -w "%{http_code}" \
  -X POST "${API_BASE}/bases-locales/${BAL_ID}/habilitation/email/validate-pin-code" \
  -H "${AUTH_HEADER}" \
  -H 'content-type: application/json' \
  -d "${validate_pin_payload}")"
[ "${validate_pin_status}" = "200" ] || {
  cat "${tmp_dir}/validate-pin.json" >&2
  exit 1
}

echo "Publishing BAL..."
publish_status="$(curl -sS -o "${tmp_dir}/publish.json" -w "%{http_code}" \
  -X POST "${API_BASE}/bases-locales/${BAL_ID}/sync/exec" \
  -H "${AUTH_HEADER}")"
[ "${publish_status}" = "200" ] || {
  cat "${tmp_dir}/publish.json" >&2
  exit 1
}

echo "Checking depot current revision..."
depot_status="$(curl -sS -o "${tmp_dir}/depot.json" -w "%{http_code}" \
  -X GET "${DEPOT_BASE}/communes/${COMMUNE}/current-revision")"
[ "${depot_status}" = "200" ] || {
  cat "${tmp_dir}/depot.json" >&2
  exit 1
}

REVISION_ID="$(jq -r '.id // empty' "${tmp_dir}/depot.json")"
if [ -z "${REVISION_ID}" ]; then
  echo "Depot response is missing revision id" >&2
  cat "${tmp_dir}/depot.json" >&2
  exit 1
fi

echo "Smoke publish passed."
echo "BAL_ID=${BAL_ID}"
echo "REVISION_ID=${REVISION_ID}"
