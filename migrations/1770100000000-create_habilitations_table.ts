import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHabilitationsTable1770100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the status enum type (idempotent: skip if already exists from a partial run)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'habilitations_status_enum') THEN
          CREATE TYPE habilitations_status_enum AS ENUM ('accepted', 'pending', 'rejected');
        END IF;
      END
      $$
    `);

    // Create the habilitations table (idempotent)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS habilitations (
        id VARCHAR(24) PRIMARY KEY,
        bal_id VARCHAR(24) NOT NULL,
        code_commune VARCHAR(7) NOT NULL,
        email_commune VARCHAR(255),
        status habilitations_status_enum NOT NULL DEFAULT 'pending',
        strategy JSONB,
        accepted_at TIMESTAMP,
        rejected_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_habilitations_bal FOREIGN KEY (bal_id)
          REFERENCES bases_locales(id) ON DELETE CASCADE
      )
    `);

    // Create indexes (idempotent)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_habilitations_bal_id ON habilitations(bal_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_habilitations_code_commune ON habilitations(code_commune)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_habilitations_status ON habilitations(status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS habilitations`);
    await queryRunner.query(`DROP TYPE IF EXISTS habilitations_status_enum`);
  }
}
