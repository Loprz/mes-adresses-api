import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsOptional, IsObject } from 'class-validator';

export class LinkGersDTO {
  @IsNotEmpty({ message: 'gersId is required' })
  @IsUUID('4', { message: 'gersId must be a valid UUID v4 (Overture GERS ID)' })
  @ApiProperty({
    required: true,
    description: 'Overture Maps GERS ID (UUID v4) to link to this entity',
    example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  })
  gersId: string;

  @IsOptional()
  @IsObject()
  @ApiProperty({
    required: false,
    description:
      'Overture provenance metadata (e.g., release version, source dataset, confidence)',
    example: {
      releaseVersion: '2025-06-25',
      dataset: 'addresses/address',
      confidence: 0.95,
    },
  })
  overtureSource?: Record<string, any>;
}
