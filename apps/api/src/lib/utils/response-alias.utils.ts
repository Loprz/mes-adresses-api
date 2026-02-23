type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
interface JsonObject {
  [key: string]: JsonValue;
}
interface JsonArray extends Array<JsonValue> {}

const CANONICAL_ALIAS_BY_KEY: Record<string, string> = {
  balId: 'localAddressBaseId',
  bbox: 'bounds',
  certifie: 'certified',
  code: 'jurisdictionCode',
  codeCommune: 'jurisdictionCode',
  commune: 'jurisdictionCode',
  communeDeleguee: 'delegatedJurisdictionCode',
  communeNom: 'jurisdictionName',
  communeNomsAlt: 'jurisdictionNamesAlt',
  communesDeleguees: 'delegatedJurisdictions',
  contour: 'boundary',
  departement: 'state',
  emailCommune: 'jurisdictionEmail',
  habilitationId: 'authorizationId',
  isHabilitationValid: 'isAuthorizationValid',
  isAllCertified: 'areAllAddressesCertified',
  nbNumeros: 'addressCount',
  nbNumerosCertifies: 'certifiedAddressCount',
  nbToponymes: 'placeNameCount',
  nbVoies: 'streetCount',
  nom: 'name',
  nomAlt: 'namesAlt',
  numero: 'houseNumber',
  numeroComplet: 'fullAddressNumber',
  numeros: 'addresses',
  parcelles: 'parcelIds',
  suffixe: 'numberSuffix',
  toponyme: 'placeName',
  toponymes: 'placeNames',
  trace: 'centerline',
  typeNumerotation: 'numberingType',
  voie: 'street',
  voies: 'streets',
};

function isPlainObject(value: unknown): value is JsonObject {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function withCanonicalAliases(
  value: JsonValue,
  visited: WeakSet<object>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => withCanonicalAliases(item, visited));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (visited.has(value)) {
    return null;
  }
  visited.add(value);

  const transformed: JsonObject = {};
  for (const [key, rawChild] of Object.entries(value)) {
    const child = withCanonicalAliases(rawChild as JsonValue, visited);
    transformed[key] = child;

    const alias = CANONICAL_ALIAS_BY_KEY[key];
    if (alias && transformed[alias] === undefined) {
      transformed[alias] = child;
    }
  }

  return transformed;
}

export function addCanonicalAliases<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (
    typeof payload === 'string' ||
    typeof payload === 'number' ||
    typeof payload === 'boolean'
  ) {
    return payload;
  }

  if (Array.isArray(payload) || isPlainObject(payload)) {
    return withCanonicalAliases(payload as JsonValue, new WeakSet()) as T;
  }

  return payload;
}
