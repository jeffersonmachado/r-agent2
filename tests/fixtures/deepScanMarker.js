'use strict';

/**
 * Fixture do teste obrigatório de ENRIQUECIMENTO CODE-AWARE (missão V2).
 *
 * A palavra marcadora `zorkmid` NÃO aparece no nome deste arquivo, mas aparece em:
 *   - comentário arquitetural (esta linha e a de baixo);
 *   - SÍMBOLO (função `zorkmidImportMembers`);
 *   - ROTA (`/api/zorkmid/sync`);
 *   - MODEL (tabela `zorkmid_records`).
 *
 * Se o Mission Compiler enriquecer apenas por nome de arquivo/path, ele NÃO encontra este arquivo —
 * e o teste que usa esta palavra falha. É isso que o torna uma prova, e não um enfeite.
 *
 * O marcador é intencionalmente único no repositório para o teste não passar por acidente.
 */

function zorkmidImportMembers(members) {
  // zorkmid: importação precisa ser idempotente (retry + upsert, nunca duplicar membro).
  if (!Array.isArray(members)) return [];
  return members.map((member) => ({ ...member, imported: true }));
}

const zorkmidRoutes = [
  { method: 'POST', path: '/api/zorkmid/sync' },
  { method: 'GET', path: '/api/zorkmid/status' },
];

const zorkmidModel = {
  tableName: 'zorkmid_records',
  fields: ['id', 'external_id', 'status'],
};

module.exports = { zorkmidImportMembers, zorkmidRoutes, zorkmidModel };
