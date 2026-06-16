import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Numero } from './numero.entity';

/**
 * NG911 extension attributes for an address (numero).
 *
 * Sibling table to `numeros` so the editor's submission core stays minimal.
 * Sparse/nullable: rows are populated only as the 911 authority supplies data
 * or as derived fields (street-name parser, minted NGUID) are cached.
 *
 * Maps to the NENA-STA-006.3 Site/Structure Address Point layer. See
 * docs/NG911_SSAP_MAPPING.md for the field-by-field bucketing.
 */
@Entity({ name: 'numeros_ng911' })
export class NumeroNg911 {
  @ApiProperty()
  @PrimaryColumn('varchar', { length: 24, name: 'numero_id' })
  numeroId: string;

  // ── Authority-supplied (cannot be derived from address data) ──────────────
  @ApiProperty({ required: false, description: 'Emergency Service Number' })
  @Column('varchar', { length: 5, nullable: true })
  esn: string | null;

  @ApiProperty({ required: false, description: 'MSAG Community Name' })
  @Column('varchar', { length: 60, name: 'msag_comm', nullable: true })
  msagComm: string | null;

  @ApiProperty({ required: false, description: 'Discrepancy Agency ID (NENA)' })
  @Column('varchar', { length: 75, name: 'discrp_ag_id', nullable: true })
  discrpAgId: string | null;

  @ApiProperty({ required: false })
  @Column('varchar', { length: 6, name: 'add_code', nullable: true })
  addCode: string | null;

  @ApiProperty({ required: false, description: 'Incorporated Municipality (A3)' })
  @Column('varchar', { length: 100, name: 'inc_muni', nullable: true })
  incMuni: string | null;

  @ApiProperty({ required: false, description: 'Unincorporated Community (A4)' })
  @Column('varchar', { length: 100, name: 'uninc_comm', nullable: true })
  unincComm: string | null;

  @ApiProperty({ required: false, description: 'Neighborhood Community (A5)' })
  @Column('varchar', { length: 100, name: 'nbrhd_comm', nullable: true })
  nbrhdComm: string | null;

  @ApiProperty({ required: false, description: 'Postal Community Name' })
  @Column('varchar', { length: 40, name: 'post_comm', nullable: true })
  postComm: string | null;

  @ApiProperty({ required: false, description: 'ZIP+4' })
  @Column('varchar', { length: 4, name: 'post_code4', nullable: true })
  postCode4: string | null;

  @ApiProperty({ required: false })
  @Column('varchar', { length: 75, nullable: true })
  building: string | null;

  @ApiProperty({ required: false })
  @Column('varchar', { length: 75, nullable: true })
  floor: string | null;

  @ApiProperty({ required: false })
  @Column('varchar', { length: 75, nullable: true })
  unit: string | null;

  @ApiProperty({ required: false })
  @Column('varchar', { length: 75, nullable: true })
  room: string | null;

  @ApiProperty({ required: false })
  @Column('varchar', { length: 75, nullable: true })
  seat: string | null;

  @ApiProperty({ required: false, description: 'Additional Location Information' })
  @Column('varchar', { length: 225, name: 'addtl_loc', nullable: true })
  addtlLoc: string | null;

  @ApiProperty({ required: false, description: 'Complete Landmark Name' })
  @Column('varchar', { length: 150, name: 'landmk_name', nullable: true })
  landmkName: string | null;

  @ApiProperty({ required: false, description: 'IANA place type' })
  @Column('varchar', { length: 50, name: 'place_type', nullable: true })
  placeType: string | null;

  @ApiProperty({ required: false, description: 'Elevation (m) — 3D, optional' })
  @Column('int', { nullable: true })
  elev: number | null;

  // ── Minted / derived cache (recomputed on edit) ───────────────────────────
  @ApiProperty({ required: false, description: 'NENA Site GUID: banId@domain' })
  @Column('varchar', { length: 254, name: 'site_nguid', nullable: true })
  siteNguid: string | null;

  @ApiProperty({ required: false })
  @Column('varchar', { length: 15, name: 'addnum_pre', nullable: true })
  addNumPre: string | null;

  @ApiProperty({ required: false, description: 'Street Name Pre Directional' })
  @Column('varchar', { length: 9, name: 'st_predir', nullable: true })
  stPreDir: string | null;

  @ApiProperty({ required: false, description: 'Street Name Pre Type' })
  @Column('varchar', { length: 50, name: 'st_pretyp', nullable: true })
  stPreTyp: string | null;

  @ApiProperty({ required: false, description: 'Street Name (parsed body)' })
  @Column('varchar', { length: 60, name: 'st_name', nullable: true })
  stName: string | null;

  @ApiProperty({ required: false, description: 'Street Name Post Type' })
  @Column('varchar', { length: 50, name: 'st_postyp', nullable: true })
  stPosTyp: string | null;

  @ApiProperty({ required: false, description: 'Street Name Post Directional' })
  @Column('varchar', { length: 9, name: 'st_posdir', nullable: true })
  stPosDir: string | null;

  @ApiProperty({ required: false, description: 'NENA placement method' })
  @Column('varchar', { length: 25, nullable: true })
  placement: string | null;

  @ApiProperty({ required: false })
  @Column('timestamp', { name: 'parsed_at', nullable: true })
  parsedAt: Date | null;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => Numero, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'numero_id' })
  numero?: Numero;
}
