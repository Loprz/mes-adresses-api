import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  MaxLength,
  Validate,
  IsOptional,
  ArrayNotEmpty,
  ValidateNested,
  IsMongoId,
  IsNotEmpty,
  IsUUID,
  Max,
  Min,
  IsInt,
} from 'class-validator';

import { Position } from '@/shared/entities/position.entity';
import { ValidatorCogCommune } from '@/shared/validators/cog.validator';
import { ValidatorBal } from '@/shared/validators/validator_bal.validator';

export class CreateNumeroDTO {
  @IsNotEmpty({ message: 'numero:The number field is required' })
  @IsInt({ message: 'numero:The number field must be an integer' })
  @Min(0, { message: 'numero:The number field must be at least 0' })
  @Max(99998, { message: 'numero:The number field must be less than 99998' })
  @ApiProperty({ required: true, nullable: false })
  numero: number;

  @IsOptional()
  @Validate(ValidatorBal, ['suffixe'])
  @ApiProperty({ required: false, nullable: true })
  suffixe?: string;

  @IsOptional()
  @MaxLength(5000, {
    message: 'comment:Field cannot exceed 5000 characters',
  })
  @ApiProperty({ required: false, nullable: true })
  comment?: string;

  @IsOptional()
  @IsMongoId()
  @ApiProperty({ type: String, required: false, nullable: true })
  toponymeId?: string;

  @IsOptional()
  @Validate(ValidatorBal, ['cad_parcelles'])
  @ApiProperty({ required: false, nullable: false })
  parcelles?: string[];

  @IsOptional()
  @ApiProperty({ required: false, nullable: false })
  certifie?: boolean;

  @IsOptional()
  @Validate(ValidatorCogCommune, ['commune_deleguee'])
  @ApiProperty({ required: false, nullable: false })
  communeDeleguee?: string | null;

  @ValidateNested({ each: true, message: 'positions must be an array' })
  @ArrayNotEmpty()
  @Type(() => Position)
  @ApiProperty({
    type: () => Position,
    isArray: true,
    required: true,
    nullable: false,
  })
  positions?: Position[];

  @IsOptional()
  @IsUUID('4', { message: 'gersId:Must be a valid UUID v4 (Overture GERS ID)' })
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Overture Maps GERS ID for address stability and cross-referencing',
  })
  gersId?: string;
}
