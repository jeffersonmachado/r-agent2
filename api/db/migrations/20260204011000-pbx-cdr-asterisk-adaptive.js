/**
 * PBX v1 - Make pbx_cdr compatible with Asterisk cdr_adaptive_odbc.
 *
 * Strategy:
 * - Add the common Asterisk CDR columns (nullable).
 * - Set default tenant_key='unknown' so inserts can omit it.
 * - Add trigger to derive tenant_key from accountcode when missing.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add common columns used by Asterisk CDR
    const cols = [
      ['clid', Sequelize.STRING(80)],
      ['dcontext', Sequelize.STRING(80)],
      ['channel', Sequelize.STRING(80)],
      ['dstchannel', Sequelize.STRING(80)],
      ['lastapp', Sequelize.STRING(80)],
      ['lastdata', Sequelize.STRING(255)],
      ['amaflags', Sequelize.INTEGER],
      ['peeraccount', Sequelize.STRING(80)],
      ['linkedid', Sequelize.STRING(80)],
      ['sequence', Sequelize.INTEGER],
    ];

    // eslint-disable-next-line no-restricted-syntax
    for (const [name, type] of cols) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.addColumn('pbx_cdr', name, { type, allowNull: true }).catch(() => {});
    }

    // Ensure tenant_key has a default so Asterisk can omit it
    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN tenant_key SET DEFAULT 'unknown'`,
    ).catch(() => {});

    // Trigger to derive tenant_key from accountcode (when omitted/unknown)
    await queryInterface.sequelize.query(
      `CREATE OR REPLACE FUNCTION pbx_cdr_set_tenant_key()
       RETURNS trigger AS $$
       BEGIN
         -- Asterisk won't provide our application PK; derive it from uniqueid when possible.
         IF (NEW.id IS NULL OR NEW.id = '') THEN
           IF (NEW.uniqueid IS NOT NULL AND NEW.uniqueid <> '') THEN
             NEW.id := 'cdr-' || NEW.uniqueid;
           ELSE
             NEW.id := 'cdr-' || EXTRACT(EPOCH FROM NOW())::bigint::text;
           END IF;
         END IF;

         -- Derive tenant from accountcode (dialplan sets CDR(accountcode)=tenantKey).
         IF (NEW.tenant_key IS NULL OR NEW.tenant_key = '' OR NEW.tenant_key = 'unknown')
            AND NEW.accountcode IS NOT NULL AND NEW.accountcode <> '' THEN
           NEW.tenant_key := NEW.accountcode;
         END IF;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql;`,
    );

    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS pbx_cdr_set_tenant_key_trg ON pbx_cdr;`,
    ).catch(() => {});

    await queryInterface.sequelize.query(
      `CREATE TRIGGER pbx_cdr_set_tenant_key_trg
       BEFORE INSERT OR UPDATE ON pbx_cdr
       FOR EACH ROW
       EXECUTE FUNCTION pbx_cdr_set_tenant_key();`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS pbx_cdr_set_tenant_key_trg ON pbx_cdr;`,
    ).catch(() => {});
    await queryInterface.sequelize.query(
      `DROP FUNCTION IF EXISTS pbx_cdr_set_tenant_key();`,
    ).catch(() => {});
    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN tenant_key DROP DEFAULT`,
    ).catch(() => {});

    // Best-effort drop columns (ignore if missing)
    const cols = [
      'clid',
      'dcontext',
      'channel',
      'dstchannel',
      'lastapp',
      'lastdata',
      'amaflags',
      'peeraccount',
      'linkedid',
      'sequence',
    ];
    // eslint-disable-next-line no-restricted-syntax
    for (const name of cols) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn('pbx_cdr', name).catch(() => {});
    }
  },
};

