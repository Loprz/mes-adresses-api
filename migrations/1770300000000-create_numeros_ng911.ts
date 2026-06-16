import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NG911 extension table for address points (numeros). Sibling to `numeros`,
 * keyed by numero_id, holding NENA-STA-006.3 Site/Structure Address Point
 * attributes that are authority-supplied or derived/cached.
 */
export class CreateNumerosNg9111770300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS numeros_ng911 (
        numero_id     VARCHAR(24) PRIMARY KEY,
        esn           VARCHAR(5),
        msag_comm     VARCHAR(60),
        discrp_ag_id  VARCHAR(75),
        add_code      VARCHAR(6),
        inc_muni      VARCHAR(100),
        uninc_comm    VARCHAR(100),
        nbrhd_comm    VARCHAR(100),
        post_comm     VARCHAR(40),
        post_code4    VARCHAR(4),
        building      VARCHAR(75),
        floor         VARCHAR(75),
        unit          VARCHAR(75),
        room          VARCHAR(75),
        seat          VARCHAR(75),
        addtl_loc     VARCHAR(225),
        landmk_name   VARCHAR(150),
        place_type    VARCHAR(50),
        elev          INTEGER,
        site_nguid    VARCHAR(254),
        addnum_pre    VARCHAR(15),
        st_predir     VARCHAR(9),
        st_pretyp     VARCHAR(50),
        st_name       VARCHAR(60),
        st_postyp     VARCHAR(50),
        st_posdir     VARCHAR(9),
        placement     VARCHAR(25),
        parsed_at     TIMESTAMP,
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_numeros_ng911_numero FOREIGN KEY (numero_id)
          REFERENCES numeros(id) ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS numeros_ng911`);
  }
}
