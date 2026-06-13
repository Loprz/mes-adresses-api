import { HttpException, HttpStatus } from '@nestjs/common';

import { CommuneService } from './commune.service';

describe('CommuneService', () => {
  const service = new CommuneService();

  it('lists states for the selector', () => {
    const states = service.listStates();

    expect(states.length).toBeGreaterThan(0);
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '06',
          abbr: 'CA',
          nom: 'California',
        }),
      ]),
    );
  });

  it('lists counties for a selected state', () => {
    const counties = service.listCounties('06');

    expect(counties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '06019',
          nom: 'Fresno County',
          stateFips: '06',
          stateAbbr: 'CA',
        }),
      ]),
    );
  });

  it('lists places for a selected county', () => {
    const places = service.listPlaces('06019');

    expect(places).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '0614218',
          nom: 'Clovis city',
          stateFips: '06',
          stateAbbr: 'CA',
          countyFips: '06019',
          countyName: 'Fresno County',
          type: 'city',
        }),
      ]),
    );
  });

  it('returns place extra data with state and county FIPS', () => {
    const place = service.getCommuneExtraData('0614218');

    expect(place.code).toBe('0614218');
    expect(place.nom).toBe('Clovis city, CA');
    expect(place.stateFips).toBe('06');
    expect(place.countyFips).toBe('06019');
    expect(place.level).toBe('place');
    expect(place.type).toBe('city');
    expect(place.countyName).toBe('Fresno County');
  });

  it('returns county extra data with state FIPS and no parent county', () => {
    const county = service.getCommuneExtraData('06019');

    expect(county.code).toBe('06019');
    expect(county.nom).toBe('Fresno County, CA');
    expect(county.stateFips).toBe('06');
    expect(county.countyFips).toBeUndefined();
    expect(county.level).toBe('county');
    expect(county.type).toBe('county');
  });

  it('throws a not-found error for an invalid state', () => {
    expect(() => service.listCounties('99')).toThrow(HttpException);

    try {
      service.listCounties('99');
    } catch (error) {
      expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });
});
