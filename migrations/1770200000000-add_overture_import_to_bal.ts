import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds bases_locales.overture_import (JSONB) to record which Overture release a
 * LAB was imported from, enabling idempotent re-runs and chunked/append loads.
 *
 * Shape: { release, importedAt, chunks, addressCount }
 */
export class AddOvertureImportToBal1770200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE bases_locales ADD COLUMN IF NOT EXISTS overture_import JSONB`,
    );
    // Partial index to make the (commune, release) idempotency lookup fast.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_bal_overture_release
         ON bases_locales (commune, (overture_import->>'release'))
       WHERE overture_import IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_bal_overture_release`,
    );
    await queryRunner.query(
      `ALTER TABLE bases_locales DROP COLUMN IF EXISTS overture_import`,
    );
  }
}
