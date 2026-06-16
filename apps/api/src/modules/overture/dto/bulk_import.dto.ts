import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  IsEmail,
  IsBoolean,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OvertureAddressInputDTO {
  @ApiProperty({
    description: 'Overture GERS ID (UUID v4)',
    example: '8ff0f103-e029-4103-9702-a331016decca',
  })
  @IsString()
  gersId: string;

  @ApiProperty({ description: 'WGS84 longitude', example: -119.7726 })
  @IsNumber()
  longitude: number;

  @ApiProperty({ description: 'WGS84 latitude', example: 36.7378 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Country code', example: 'US' })
  @IsString()
  country: string;

  @ApiPropertyOptional({ description: 'ZIP/Postal code', example: '93706' })
  @IsString()
  @IsOptional()
  postcode?: string;

  @ApiProperty({ description: 'Street name', example: 'N BLACKSTONE AVE' })
  @IsString()
  street: string;

  @ApiProperty({ description: 'Address number', example: '2025' })
  @IsString()
  number: string;

  @ApiPropertyOptional({ description: 'Unit/suite/apt', example: 'STE 100' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ description: 'Postal city name' })
  @IsString()
  @IsOptional()
  postalCity?: string;

  @ApiPropertyOptional({ description: 'Address levels (state, city)' })
  @IsArray()
  @IsOptional()
  addressLevels?: { value: string }[];

  @ApiPropertyOptional({ description: 'Overture source metadata' })
  @IsArray()
  @IsOptional()
  sources?: {
    property?: string;
    dataset?: string;
    confidence?: number;
  }[];
}

export class BulkImportOvertureDTO {
  @ApiProperty({
    description:
      'FIPS code of the jurisdiction (5-digit county or 7-digit place)',
    example: '06019',
  })
  @IsString()
  fipsCode: string;

  @ApiPropertyOptional({
    description: 'Admin email for the created LAB',
    example: 'admin@fresnocounty.gov',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Overture release version this batch was extracted from (e.g. 2026-05-20.0). ' +
      'Stored on the LAB for idempotency and recorded as provenance on each address.',
    example: '2026-05-20.0',
  })
  @IsString()
  @IsOptional()
  release?: string;

  @ApiPropertyOptional({
    description:
      'Append this batch to an existing LAB instead of creating a new one. ' +
      'Used to load large counties across multiple chunked POSTs. Requires ' +
      'balId and token from the first (non-append) chunk.',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  append?: boolean;

  @ApiPropertyOptional({
    description: 'Target LAB id when append=true.',
  })
  @IsString()
  @IsOptional()
  balId?: string;

  @ApiPropertyOptional({
    description: 'Target LAB token when append=true (authorizes the append).',
  })
  @IsString()
  @IsOptional()
  token?: string;

  @ApiProperty({
    description: 'Array of Overture address records to import',
    type: [OvertureAddressInputDTO],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OvertureAddressInputDTO)
  addresses: OvertureAddressInputDTO[];
}
