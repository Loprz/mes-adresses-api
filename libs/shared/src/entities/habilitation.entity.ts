import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ObjectId } from 'mongodb';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum StatusHabilitationEnum {
  ACCEPTED = 'accepted',
  PENDING = 'pending',
  REJECTED = 'rejected',
}

export enum TypeStrategyEnum {
  EMAIL = 'email',
  LOGIN_GOV = 'login_gov', // Future: Login.gov integration
  INTERNAL = 'internal',
}

export type Strategy = {
  type: TypeStrategyEnum;
  pinCode?: string;
  pinCodeExpiration?: Date | null;
  createdAt?: Date | null;
  remainingAttempts?: number;
};

@Entity({ name: 'habilitations' })
export class Habilitation {
  @ApiProperty()
  @PrimaryColumn('varchar', { length: 24 })
  id: string;

  @BeforeInsert()
  generatedObjectId?() {
    if (!this.id) {
      this.id = new ObjectId().toHexString();
    }
  }

  @ApiProperty()
  @Index('IDX_habilitations_bal_id')
  @Column('varchar', { name: 'bal_id', length: 24, nullable: false })
  balId: string;

  @ApiProperty()
  @Index('IDX_habilitations_code_commune')
  @Column('varchar', { name: 'code_commune', length: 7, nullable: false })
  codeCommune: string;

  @ApiProperty()
  @Column('varchar', { name: 'email_commune', length: 255, nullable: true })
  emailCommune: string;

  @ApiProperty({ enum: StatusHabilitationEnum })
  @Index('IDX_habilitations_status')
  @Column('enum', {
    enum: StatusHabilitationEnum,
    default: StatusHabilitationEnum.PENDING,
    nullable: false,
  })
  status: StatusHabilitationEnum;

  @ApiPropertyOptional()
  @Column('jsonb', { nullable: true })
  strategy: Strategy | null;

  @ApiPropertyOptional()
  @Column('timestamp', { name: 'accepted_at', nullable: true })
  acceptedAt: Date | null;

  @ApiPropertyOptional()
  @Column('timestamp', { name: 'rejected_at', nullable: true })
  rejectedAt: Date | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
