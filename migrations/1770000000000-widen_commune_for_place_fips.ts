import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen commune/jurisdiction columns from varchar(5) to varchar(7)
 * to support both county FIPS (5-digit) and place FIPS (7-digit) codes.
 *
 * This allows LABs to be scoped to individual cities/towns (7-digit)
 * in addition to counties (5-digit).
 *
 * Examples:
 *   "06037"   = Los Angeles County, CA (county)
 *   "0644000" = Los Angeles city, CA (place)
 */
export class WidenCommuneForPlaceFips1770000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Widen base_locale.commune from varchar(5) to varchar(7)
    await queryRunner.query(`
      ALTER TABLE bases_locales
      ALTER COLUMN commune TYPE varchar(7)
    `);

    // Widen numero.commune_deleguee from varchar(5) to varchar(7)
    await queryRunner.query(`
      ALTER TABLE numeros
      ALTER COLUMN commune_deleguee TYPE varchar(7)
    `);

    // Widen toponyme.commune_deleguee from varchar(5) to varchar(7)
    await queryRunner.query(`
      ALTER TABLE toponymes
      ALTER COLUMN commune_deleguee TYPE varchar(7)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to varchar(5) — will fail if any 7-digit codes exist
    await queryRunner.query(`
      ALTER TABLE bases_locales
      ALTER COLUMN commune TYPE varchar(5)
    `);

    await queryRunner.query(`
      ALTER TABLE numeros
      ALTER COLUMN commune_deleguee TYPE varchar(5)
    `);

    await queryRunner.query(`
      ALTER TABLE toponymes
      ALTER COLUMN commune_deleguee TYPE varchar(5)
    `);
  }
}
