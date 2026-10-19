'use strict';

/**
 * Store canônico dos registros do CRM (`crm_records`).
 *
 * DEFEITO P0 MEDIDO (auditoria 2026-10-19, SHA 511ae5249): a persistência usava
 * `Model.upsert({ id, tenant_key, entity, payload })` com chave primária apenas
 * `id`. O Sequelize traduz isso para `INSERT ... ON CONFLICT (id) DO UPDATE SET
 * tenant_key = ..., payload = ...`. Consequência: um tenant que enviasse no POST
 * o `id` de um registro de OUTRO tenant sobrescrevia o registro alheio E
 * transferia a propriedade (`tenant_key` mudava). Confidencialidade, integridade
 * e isolamento multitenant ficavam a cargo do cliente.
 *
 * Regra deste módulo: criação, leitura, atualização e exclusão são operações
 * SEPARADAS e a condição de tenant está SEMPRE na própria operação SQL — nunca
 * em uma consulta prévia seguida de escrita (o que abre janela TOCTOU).
 *
 *  - criar:     INSERT puro. Colisão de id (mesmo tenant ou outro) → 409
 *               `id_indisponivel`. Nunca atualiza. `tenant_key` vem do contexto
 *               autenticado, jamais do payload.
 *  - atualizar: UPDATE ... WHERE id = ? AND tenant_key = ? AND entity = ?.
 *               0 linhas afetadas → `null` (404 na rota). Nunca cria.
 *  - remover:   DELETE com a mesma condição de tenant.
 *
 * `upsert` é PROIBIDO aqui — há teste de regressão que falha se ele voltar
 * (o bug só existe porque a criação e a atualização eram a mesma chamada).
 */

const ENTIDADES_VALIDAS = Object.freeze([
  'accounts',
  'pipelines',
  'opportunities',
  'activities',
]);

// Ids do cliente: opacos, sem espaço/barra/controle. Tamanho limitado para não
// virar chave arbitrária de armazenamento.
const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

// Resolve pelo ÍNDICE de models (mesma fábrica usada pelas rotas): mantém a
// inicialização lazy do Sequelize e permite substituição em teste.
let modelFactory = () => {
  const models = require('../../db/models');
  const factory = models.CrmRecord;
  return typeof factory === 'function' ? factory() : factory;
};

/** Injeção para teste (modelo próprio/transaction). */
function __setModelFactory(fn) {
  modelFactory = fn;
}

function model() {
  return modelFactory();
}

class CrmConflictError extends Error {
  constructor(id) {
    super(`id indisponível: ${id}`);
    this.name = 'CrmConflictError';
    this.code = 'id_indisponivel';
    this.httpStatus = 409;
  }
}

class CrmValidationError extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'CrmValidationError';
    this.code = 'dados_invalidos';
    this.httpStatus = 400;
  }
}

function exigirTenant(tenantId) {
  const chave = tenantId === undefined || tenantId === null ? '' : String(tenantId).trim();
  if (!chave) throw new CrmValidationError('tenant ausente no contexto autenticado');
  return chave;
}

function exigirEntidade(entity) {
  const alvo = String(entity || '').trim();
  if (!ENTIDADES_VALIDAS.includes(alvo)) {
    throw new CrmValidationError(`entidade inválida: ${alvo || '(vazia)'}`);
  }
  return alvo;
}

function exigirId(id) {
  const alvo = String(id === undefined || id === null ? '' : id).trim();
  if (!ID_VALIDO.test(alvo)) throw new CrmValidationError('id inválido');
  return alvo;
}

/**
 * Remove campos de CONTROLE do payload. O cliente nunca define a quem o registro
 * pertence, nem o id por dentro do JSONB (o id é coluna).
 */
function sanitizarPayload(payload) {
  const bruto = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const limpo = { ...bruto };
  // `id` também sai do JSONB: se ficasse, um payload poderia FORJAR o id
  // devolvido nas listagens (medido em 2026-10-19: registro do tenant B
  // aparecia com o id de um registro de A).
  delete limpo.id;
  delete limpo.tenantId;
  delete limpo.tenant_key;
  delete limpo.tenantKey;
  delete limpo.entity;
  return limpo;
}

function toItem(row) {
  const r = row && row.toJSON ? row.toJSON() : (row || {});
  // A coluna manda: o payload nunca sobrescreve `id`.
  return { ...(r.payload || {}), id: r.id };
}

async function criarRegistro({ tenantId, entity, id, payload }) {
  const chave = exigirTenant(tenantId);
  const alvo = exigirEntidade(entity);
  const registroId = exigirId(id);
  try {
    const row = await model().create({
      id: registroId,
      tenant_key: chave,
      entity: alvo,
      payload: sanitizarPayload(payload),
    });
    return toItem(row);
  } catch (err) {
    // Colisão de id: NUNCA atualiza e NUNCA revela de quem é o registro.
    if (err && (err.name === 'SequelizeUniqueConstraintError' || err.code === '23505' || err.code === 'SQLITE_CONSTRAINT')) {
      throw new CrmConflictError(registroId);
    }
    throw err;
  }
}

async function lerRegistro({ tenantId, entity, id }) {
  const chave = exigirTenant(tenantId);
  const alvo = exigirEntidade(entity);
  const registroId = exigirId(id);
  const row = await model().findOne({
    where: { id: registroId, tenant_key: chave, entity: alvo },
  });
  return row ? toItem(row) : null;
}

async function listarRegistros({ tenantId, entity, limit = 20, offset = 0 }) {
  const chave = exigirTenant(tenantId);
  const alvo = exigirEntidade(entity);
  const { rows, count } = await model().findAndCountAll({
    where: { tenant_key: chave, entity: alvo },
    order: [['updated_at', 'DESC']],
    limit,
    offset,
  });
  return { items: (rows || []).map(toItem), total: Number(count || 0), limit, offset };
}

/**
 * Atualização escopada. O `WHERE` carrega o tenant: um id de outro tenant não é
 * encontrado (0 linhas) e a rota responde 404 — sem criar, sem transferir.
 *
 * `payload` é o objeto COMPLETO do registro (o chamador mescla antes), mas os
 * campos de controle são descartados aqui e `tenant_key` nunca entra no SET.
 */
async function atualizarRegistro({ tenantId, entity, id, payload }) {
  const chave = exigirTenant(tenantId);
  const alvo = exigirEntidade(entity);
  const registroId = exigirId(id);
  const [afetados] = await model().update(
    { payload: sanitizarPayload(payload), updated_at: new Date() },
    { where: { id: registroId, tenant_key: chave, entity: alvo } },
  );
  if (!afetados) return null;
  return lerRegistro({ tenantId: chave, entity: alvo, id: registroId });
}

async function removerRegistro({ tenantId, entity, id }) {
  const chave = exigirTenant(tenantId);
  const alvo = exigirEntidade(entity);
  const registroId = exigirId(id);
  const removidos = await model().destroy({
    where: { id: registroId, tenant_key: chave, entity: alvo },
  });
  return removidos > 0;
}

module.exports = {
  ENTIDADES_VALIDAS,
  CrmConflictError,
  CrmValidationError,
  criarRegistro,
  lerRegistro,
  listarRegistros,
  atualizarRegistro,
  removerRegistro,
  sanitizarPayload,
  __setModelFactory,
};
