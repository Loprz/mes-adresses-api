import { ApiProperty } from '@nestjs/swagger';

export class SubJurisdictionDTO {
  @ApiProperty()
  code: string;

  @ApiProperty()
  nom: string;
}

export class CommuneDTO {
  @ApiProperty()
  code: string;

  @ApiProperty()
  codeCommunesCadastre?: string[];

  @ApiProperty()
  nom: string;

  @ApiProperty({ description: '2-digit state FIPS code', required: false })
  stateFips?: string;

  @ApiProperty({
    description: 'Parent county FIPS code for places',
    required: false,
    nullable: true,
  })
  countyFips?: string | null;

  @ApiProperty({ description: 'Whether this is a place (city/town) or county' })
  level?: 'place' | 'county';

  @ApiProperty({ description: 'Type: city, town, village, borough, or county' })
  type?: string;

  @ApiProperty({ description: 'Parent county name (for places)' })
  countyName?: string;

  @ApiProperty()
  isCOM: boolean;

  @ApiProperty({ description: 'Whether parcel tile data is available for this jurisdiction' })
  hasParcels: boolean;

  @ApiProperty()
  hasOpenMapTiles: boolean;

  @ApiProperty()
  hasOrtho: boolean;

  @ApiProperty()
  hasPlanIGN: boolean;

  @ApiProperty({ type: () => SubJurisdictionDTO, isArray: true })
  communesDeleguees: SubJurisdictionDTO[];
}

export class JurisdictionStateDTO {
  @ApiProperty({ description: '2-digit state FIPS code' })
  code: string;

  @ApiProperty({ description: '2-letter postal abbreviation' })
  abbr: string;

  @ApiProperty({ description: 'Full state name' })
  nom: string;
}

export class JurisdictionCountyDTO {
  @ApiProperty({ description: '5-digit county FIPS code' })
  code: string;

  @ApiProperty({ description: 'County name' })
  nom: string;

  @ApiProperty({ description: '2-digit state FIPS code' })
  stateFips: string;

  @ApiProperty({ description: '2-letter postal abbreviation' })
  stateAbbr: string;
}

export class JurisdictionPlaceDTO {
  @ApiProperty({ description: '7-digit place FIPS code' })
  code: string;

  @ApiProperty({ description: 'Place name' })
  nom: string;

  @ApiProperty({ description: '2-digit state FIPS code' })
  stateFips: string;

  @ApiProperty({ description: '2-letter postal abbreviation' })
  stateAbbr: string;

  @ApiProperty({
    description: 'Parent county FIPS code when a single county is defined',
    required: false,
    nullable: true,
  })
  countyFips?: string | null;

  @ApiProperty({ description: 'Parent county name(s)', required: false })
  countyName?: string;

  @ApiProperty({
    description: 'Place type: city, town, village, borough, or place',
    required: false,
  })
  type?: string;
}
