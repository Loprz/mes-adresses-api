import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add Overture Maps GERS (Global Entity Reference System) ID support.
 *
 * GERS IDs are UUID v4 identifiers that provide stable, persistent references
 * to real-world geographic entities across Overture Maps releases. By storing
 * GERS IDs alongside our internal IDs, we enable:
 *
 * 1. Bidirectional data quality feedback between NAP and Overture
 * 2. Address stability through persistent identifiers
 * 3. Easy data import/export with the Overture ecosystem
 * 4. Cross-referencing with any GERS-enabled dataset (446M+ addresses)
 *
 * See: https://docs.overturemaps.org/gers
 */
export class AddGersId1760000000000 implements MigrationInterface {
  name = 'AddGersId1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add gers_id to numeros (address points → Overture address features)
    await queryRunner.query(
      `ALTER TABLE "numeros" ADD "gers_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_numeros_gers_id" ON "numeros" ("gers_id") WHERE "gers_id" IS NOT NULL`,
    );

    // Add overture_source JSONB to numeros for provenance tracking
    // Stores: { version, sources, importedAt, confidence }
    await queryRunner.query(
      `ALTER TABLE "numeros" ADD "overture_source" jsonb`,
    );

    // Add gers_id to voies (streets → Overture transportation segments)
    await queryRunner.query(
      `ALTER TABLE "voies" ADD "gers_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_voies_gers_id" ON "voies" ("gers_id") WHERE "gers_id" IS NOT NULL`,
    );

    // Add gers_id to toponymes (place names → Overture places)
    await queryRunner.query(
      `ALTER TABLE "toponymes" ADD "gers_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_toponymes_gers_id" ON "toponymes" ("gers_id") WHERE "gers_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_toponymes_gers_id"`);
    await queryRunner.query(`ALTER TABLE "toponymes" DROP COLUMN "gers_id"`);

    await queryRunner.query(`DROP INDEX "IDX_voies_gers_id"`);
    await queryRunner.query(`ALTER TABLE "voies" DROP COLUMN "gers_id"`);

    await queryRunner.query(`ALTER TABLE "numeros" DROP COLUMN "overture_source"`);
    await queryRunner.query(`DROP INDEX "IDX_numeros_gers_id"`);
    await queryRunner.query(`ALTER TABLE "numeros" DROP COLUMN "gers_id"`);
  }
}
