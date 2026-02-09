import {
  getJurisdiction,
  getJurisdictionName,
  getCountiesByState,
  searchJurisdictions,
  JurisdictionSearchResult,
} from '@/shared/utils/fips.utils';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CommuneDTO } from './dto/commune.dto';

@Injectable()
export class CommuneService {
  constructor() {}

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
