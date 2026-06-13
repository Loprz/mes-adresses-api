import {
  getAllStates,
  getState,
  getJurisdiction,
  getJurisdictionName,
  getCountiesByState,
  getSelectablePlacesByCounty,
  searchJurisdictions,
  JurisdictionSearchResult,
} from '@/shared/utils/fips.utils';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  CommuneDTO,
  JurisdictionCountyDTO,
  JurisdictionPlaceDTO,
  JurisdictionStateDTO,
} from './dto/commune.dto';

@Injectable()
export class CommuneService {
  constructor() {}

  listStates(): JurisdictionStateDTO[] {
    return getAllStates()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((state) => ({
        code: state.code,
        abbr: state.abbr,
        nom: state.name,
      }));
  }

  listCounties(stateFips: string): JurisdictionCountyDTO[] {
    const state = getState(stateFips);

    if (!state) {
      throw new HttpException(
        `State with FIPS code ${stateFips} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return getCountiesByState(stateFips)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((county) => ({
        code: county.code,
        nom: county.name,
        stateFips: county.stateFips,
        stateAbbr: county.stateAbbr,
      }));
  }

  listPlaces(countyFips: string): JurisdictionPlaceDTO[] {
    const county = getJurisdiction(countyFips);

    if (!county || county.level !== 'county') {
      throw new HttpException(
        `County with FIPS code ${countyFips} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return getSelectablePlacesByCounty(countyFips)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((place) => ({
        code: place.code,
        nom: place.name,
        stateFips: place.stateFips,
        stateAbbr: place.stateAbbr,
        countyFips: place.countyFips,
        countyName: place.countyName,
        type: place.type,
      }));
  }

  searchCommunes(
    query: string,
    limit = 20,
  ): JurisdictionSearchResult[] {
    return searchJurisdictions(query, limit);
  }

  getCommuneExtraData(codeCommune: string): CommuneDTO {
    const jurisdiction = getJurisdiction(codeCommune);
    if (!jurisdiction) {
      throw new HttpException(
        `Jurisdiction with FIPS code ${codeCommune} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      code: jurisdiction.code,
      nom: getJurisdictionName(codeCommune) || jurisdiction.name,
      stateFips: jurisdiction.stateFips,
      countyFips: jurisdiction.countyFips,
      level: jurisdiction.level,
      type: jurisdiction.type || (jurisdiction.level === 'county' ? 'county' : undefined),
      countyName: jurisdiction.countyName || undefined,
      // In the US, all jurisdictions have OpenMapTiles and satellite imagery
      hasOpenMapTiles: true,
      hasOrtho: true,
      hasPlanIGN: true,
      // Parcel data availability is determined by the frontend tile configuration
      // (NEXT_PUBLIC_PARCEL_TILES_URL). The backend always returns true to allow
      // the frontend to decide based on its own configuration.
      hasParcels: true,
      // No overseas territory distinction in the US context
      isCOM: false,
      // No delegated communes in the US model
      communesDeleguees: [],
    };
  }
}
