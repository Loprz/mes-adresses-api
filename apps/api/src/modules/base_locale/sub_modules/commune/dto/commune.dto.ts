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
