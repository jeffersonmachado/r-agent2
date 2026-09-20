'use strict';

/**
 * T24b — DB_POOL_MIN nunca >0 no env compartilhado. Defeito medido em
 * 2026-09-20: com DB_POOL_MIN=2 no .env, o pool Sequelize mantém 2 conexões
 * abertas para sempre; scripts fire-and-forget que leem o mesmo .env
 * (QA Mesh, batches RPA via --env-file-if-exists) completam o trabalho,
 * gravam o report PASS e NUNCA encerram o processo (0% CPU, 2 sockets
 * ESTABLISHED para o Postgres) — o batch business screens ficou 77min
 * parado e o mesh/candidato morreram por arrasto. O .env é lido tanto pelo
 * servidor API (onde min>0 seria inócuo) quanto pelos scripts de QA/
 * governança (onde é fatal), então o piso documentado é 0.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const ENV_EXAMPLE = fs.readFileSync(path.join(ROOT, 'env.example'), 'utf8');

describe('env.example — pool Sequelize seguro para scripts fire-and-forget (T24b)', () => {
  it('documenta DB_POOL_MIN=0 (piso de pool mantém conexão viva e trava exit)', () => {
    expect(ENV_EXAMPLE).toMatch(/DB_POOL_MIN=0/);
  });

  it('não sugere DB_POOL_MIN maior que zero', () => {
    expect(ENV_EXAMPLE).not.toMatch(/DB_POOL_MIN=[1-9]/);
  });
});
