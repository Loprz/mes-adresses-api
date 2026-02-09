import {
  Strategy,
  StatusHabilitationEnum,
  TypeStrategyEnum,
} from '@/shared/entities/habilitation.entity';
import { ApiProperty } from '@nestjs/swagger';

export class StrategyDTO {
  @ApiProperty({ enum: TypeStrategyEnum })
  type: TypeStrategyEnum;

  @ApiProperty()
  pinCodeExpiration: Date;

  @ApiProperty()
  remainingAttempts: number;

  @ApiProperty()
  createdAt: Date;
}

export class HabilitationDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  balId: string;

  @ApiProperty()
  codeCommune: string;

  @ApiProperty()
  emailCommune: string;

  @ApiProperty({ type: () => StrategyDTO })
  strategy?: Strategy;

  @ApiProperty({ enum: StatusHabilitationEnum })
  status: StatusHabilitationEnum;

  @ApiProperty()
  acceptedAt?: Date;

  @ApiProperty()
  rejectedAt?: Date;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  updatedAt?: Date;
}
