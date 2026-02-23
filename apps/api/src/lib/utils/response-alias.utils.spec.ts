import { addCanonicalAliases } from './response-alias.utils';

describe('addCanonicalAliases', () => {
  it('adds canonical aliases without removing legacy keys', () => {
    const payload = {
      commune: '0625436',
      nom: 'Fowler city, CA',
      voies: [{ id: 'v1', nom: 'E Katherine Ave', bbox: [-1, -1, 1, 1] }],
      toponymes: [{ id: 't1', nom: 'Old Mill' }],
      numeros: [{ id: 'n1', numero: 100, suffixe: 'A', certifie: true }],
    };

    const result = addCanonicalAliases(payload) as any;

    expect(result.commune).toBe('0625436');
    expect(result.jurisdictionCode).toBe('0625436');
    expect(result.nom).toBe('Fowler city, CA');
    expect(result.name).toBe('Fowler city, CA');

    expect(result.voies[0].nom).toBe('E Katherine Ave');
    expect(result.voies[0].name).toBe('E Katherine Ave');
    expect(result.voies[0].bbox).toEqual([-1, -1, 1, 1]);
    expect(result.voies[0].bounds).toEqual([-1, -1, 1, 1]);
    expect(result.streets).toEqual(result.voies);

    expect(result.toponymes[0].name).toBe('Old Mill');
    expect(result.placeNames).toEqual(result.toponymes);

    expect(result.numeros[0].houseNumber).toBe(100);
    expect(result.numeros[0].numberSuffix).toBe('A');
    expect(result.numeros[0].certified).toBe(true);
    expect(result.addresses).toEqual(result.numeros);
  });

  it('does not overwrite existing canonical keys if already present', () => {
    const payload = {
      commune: '1234567',
      jurisdictionCode: 'already-set',
    };

    const result = addCanonicalAliases(payload) as any;

    expect(result.commune).toBe('1234567');
    expect(result.jurisdictionCode).toBe('already-set');
  });

  it('returns primitives unchanged', () => {
    expect(addCanonicalAliases('ok')).toBe('ok');
    expect(addCanonicalAliases(42)).toBe(42);
    expect(addCanonicalAliases(true)).toBe(true);
    expect(addCanonicalAliases(null)).toBeNull();
  });

  it('does not recurse infinitely on cyclic objects', () => {
    const payload: any = { nom: 'Cycle' };
    payload.self = payload;

    const result = addCanonicalAliases(payload) as any;

    expect(result.name).toBe('Cycle');
    expect(result.self).toBeNull();
  });
});
