'use strict';

/**
 * dbIntegrityWave — motor puro da Database Integrity Wave.
 *
 * Sem I/O (nada de fs/DB/rede): recebe dados coletados pelo runner
 * (`scripts/governance/db-integrity-wave.js`) e produz o estado de cobertura
 * de cada model do inventário.
 *
 * Assertivas por model:
 *
 * TIER ESTÁTICO (sempre executado):
 *   - modelFileParses:      o arquivo fonte do model existe e parseia
 *                           (via modelScanner, sem require/DB).
 *   - tableNameDefined:     o model tem tableName (explícito ou derivado).
 *   - primaryKeyDefined:    há campo com primaryKey:true, campo `id`, ou PK
 *                           implícita do Sequelize (quando nenhum campo marca
 *                           primaryKey o define adiciona `id` automaticamente).
 *   - migrationFound:       ao menos uma migration referencia a tabela
 *                           (createTable('<table>') ou ocorrência quotada).
 *   - tenantScope:          OBSERVAÇÃO — nunca falha. Se o model não tem
 *                           tenant_id/tenant_key, registra warning 'absent'
 *                           (models globais legítimos existem).
 *   - timestampsDefined:    falha apenas se o model desativa timestamps
 *                           explicitamente sem declarar created/updated.
 *
 * TIER LIVE (somente com DB disponível):
 *   - tableExistsInDb:        a tabela existe em information_schema.tables.
 *   - modelColumnsExistInDb:  toda coluna do model (field→column, com
 *                             conversão camelCase→snake_case) existe na tabela.
 *   - primaryKeyExistsInDb:   a tabela tem constraint PRIMARY KEY no banco.
 *
 * Estado final por model (precedência FAILED > VISITED > VALIDATED):
 *   - qualquer assertiva falha (estática ou live)        → FAILED
 *   - estático passa + live indisponível                 → VISITED
 *   - estático passa + live passa                        → VALIDATED
 *
 * Isenções justificadas (config/db-integrity-exemptions.json):
 *   { "<ModelName>": { "assertion", "reason", "approvedBy", "date" } } — quando
 *   todos os campos obrigatórios estão presentes e a assertiva existe para o
 *   model, ela é marcada NOT_APPLICABLE (passed=true, não conta contra
 *   VALIDATED) e a isenção é registrada no resultado (auditável). Isenção sem
 *   campos obrigatórios ou para assertiva inexistente é IGNORADA: a assertiva
 *   continua valendo (e falhando) normalmente.
 */

const { COVERAGE_STATES } = require('./coverageStates');

const WAVE_ID = 'db-integrity-wave';

const TIMESTAMP_FIELD_NAMES = new Set(['createdAt', 'created_at', 'updatedAt', 'updated_at']);

const EXEMPTION_REQUIRED_FIELDS = ['assertion', 'reason', 'approvedBy', 'date'];

/** Isenção válida: todos os campos obrigatórios presentes e não vazios. */
function isValidExemption(exemption) {
  return Boolean(exemption) && typeof exemption === 'object'
    && EXEMPTION_REQUIRED_FIELDS.every((field) => typeof exemption[field] === 'string' && exemption[field].trim() !== '');
}

/**
 * Aplica isenção justificada às assertivas de um model: a assertiva citada vira
 * NOT_APPLICABLE (passed=true, sem warning, não conta contra VALIDATED).
 * Retorna { assertions, applied } — applied=null quando a assertiva não existe.
 */
function applyExemption(assertions, exemption, modelName) {
  if (!exemption) return { assertions, applied: null };
  const index = assertions.findIndex((a) => a.name === exemption.assertion);
  if (index === -1) return { assertions, applied: null };
  const updated = [...assertions];
  updated[index] = {
    ...updated[index],
    passed: true,
    warning: false,
    notApplicable: true,
    detail: `${updated[index].detail} | NOT_APPLICABLE — isenção justificada: `
      + `${exemption.reason} (aprovada por ${exemption.approvedBy} em ${exemption.date})`,
  };
  return {
    assertions: updated,
    applied: {
      model: modelName,
      assertion: exemption.assertion,
      reason: exemption.reason,
      approvedBy: exemption.approvedBy,
      date: exemption.date,
    },
  };
}

/** camelCase/PascalCase → snake_case (tolerante a nomes já snake). */
function toSnakeCase(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/** Coluna física esperada de um campo do model (field mapeado ou snake_case). */
function expectedColumnName(fieldName, field) {
  if (field && field.column) return field.column;
  return toSnakeCase(fieldName);
}

function assertion(name, passed, detail, extra = {}) {
  return { name, passed: Boolean(passed), detail: detail || '', ...extra };
}

/**
 * Avalia as assertivas estáticas de um model.
 *
 * @param {object} modelData
 * @param {string} modelData.id id do item de inventário (`model:<Nome>`)
 * @param {string} modelData.model nome do model
 * @param {object|null} modelData.parsed resultado de parseModelFile (null se o
 *   arquivo não existe)
 * @param {boolean} [modelData.timestampsDisabled] fonte declara timestamps:false
 * @param {string[]} [modelData.migrationMatches] migrations que referenciam a tabela
 * @returns {object[]} assertivas estáticas
 */
function evaluateStaticAssertions(modelData) {
  const parsed = modelData.parsed || null;
  const parseOk = Boolean(parsed) && !parsed.parseError;
  const fields = (parseOk && parsed.fields) || {};
  const fieldEntries = Object.entries(fields);
  const migrationMatches = modelData.migrationMatches || [];

  const assertions = [];

  assertions.push(assertion(
    'modelFileParses',
    parseOk,
    parseOk ? `parse ok (${modelData.source || 'fonte desconhecida'})`
      : `arquivo ausente ou sem sequelize.define literal (${modelData.source || 'fonte desconhecida'})`,
  ));

  assertions.push(assertion(
    'tableNameDefined',
    parseOk && Boolean(parsed.tableName),
    parseOk && parsed.tableName ? `tableName=${parsed.tableName}` : 'tableName não definido',
  ));

  const explicitPk = fieldEntries.filter(([, field]) => field.primaryKey).map(([name]) => name);
  const hasIdField = fieldEntries.some(([name]) => name === 'id');
  let pkDetail;
  if (explicitPk.length > 0) pkDetail = `PK explícita: ${explicitPk.join(', ')}`;
  else if (hasIdField) pkDetail = 'campo id presente';
  else pkDetail = 'PK implícita do Sequelize (id autoincrement)';
  assertions.push(assertion(
    'primaryKeyDefined',
    parseOk && (explicitPk.length > 0 || hasIdField || fieldEntries.length > 0),
    parseOk ? pkDetail : 'impossível determinar (parse falhou)',
  ));

  assertions.push(assertion(
    'migrationFound',
    migrationMatches.length > 0,
    migrationMatches.length > 0
      ? `migrations: ${migrationMatches.join(', ')}`
      : `nenhuma migration referencia '${parseOk ? parsed.tableName : '?'}'`,
  ));

  const hasTenantId = parseOk && Boolean(parsed.hasTenantId);
  assertions.push(assertion(
    'tenantScope',
    true, // observação: nunca falha (models globais legítimos existem)
    hasTenantId ? 'tenant scope presente' : 'tenant scope ausente (model global?)',
    { warning: !hasTenantId, tenantScope: hasTenantId ? 'present' : 'absent' },
  ));

  const declaresTimestamps = fieldEntries.some(([name]) => TIMESTAMP_FIELD_NAMES.has(name));
  const timestampsDisabled = Boolean(modelData.timestampsDisabled);
  assertions.push(assertion(
    'timestampsDefined',
    !timestampsDisabled || declaresTimestamps,
    declaresTimestamps
      ? 'campos de timestamp declarados'
      : (timestampsDisabled ? 'timestamps:false sem campos created/updated' : 'timestamps via default do Sequelize'),
  ));

  return assertions;
}

/**
 * Avalia as assertivas live de um model (requer dados do information_schema).
 *
 * @param {object} modelData ver evaluateStaticAssertions
 * @param {object} live
 * @param {boolean} live.tableExists
 * @param {string[]} live.columns colunas reais da tabela
 * @param {string[]} live.primaryKeyColumns colunas da PK real da tabela
 */
function evaluateLiveAssertions(modelData, live) {
  const parsed = modelData.parsed;
  const fields = (parsed && parsed.fields) || {};
  const assertions = [];

  assertions.push(assertion(
    'tableExistsInDb',
    live.tableExists,
    live.tableExists ? `tabela '${parsed.tableName}' existe` : `tabela '${parsed.tableName}' ausente no banco`,
  ));

  if (live.tableExists) {
    const actual = new Set(live.columns || []);
    const missing = Object.entries(fields)
      .map(([name, field]) => expectedColumnName(name, field))
      .filter((column) => !actual.has(column));
    assertions.push(assertion(
      'modelColumnsExistInDb',
      missing.length === 0,
      missing.length === 0
        ? `${Object.keys(fields).length} colunas do model presentes`
        : `colunas ausentes no banco: ${missing.join(', ')}`,
    ));

    const pkColumns = live.primaryKeyColumns || [];
    assertions.push(assertion(
      'primaryKeyExistsInDb',
      pkColumns.length > 0,
      pkColumns.length > 0 ? `PK no banco: ${pkColumns.join(', ')}` : 'tabela sem PRIMARY KEY no banco',
    ));
  }

  return assertions;
}

/**
 * Avalia um model e resolve seu estado de cobertura.
 *
 * @param {object} modelData
 * @param {boolean} dbAvailable
 * @param {object|null} [modelData.live] dados do information_schema (obrigatório
 *   quando dbAvailable=true; se ausente, o model fica VISITED com razão)
 * @returns {{ id, model, table, state, assertions, failedAssertions, warnings }}
 */
function evaluateModel(modelData, { dbAvailable = false, dbUnavailableReason = null, exemption = null } = {}) {
  const parsed = modelData.parsed || null;
  let exemptionApplied = null;
  const staticResult = applyExemption(evaluateStaticAssertions(modelData), exemption, modelData.model);
  const staticAssertions = staticResult.assertions;
  if (staticResult.applied) exemptionApplied = staticResult.applied;
  const staticFailures = staticAssertions.filter((a) => !a.passed);

  let assertions = staticAssertions;
  let state;
  if (staticFailures.length > 0) {
    state = COVERAGE_STATES.FAILED;
  } else if (!dbAvailable) {
    state = COVERAGE_STATES.VISITED;
    assertions = [...assertions, assertion(
      'liveTierSkipped',
      true,
      `tier live indisponível: ${dbUnavailableReason || 'DB indisponível'}`,
      { informational: true },
    )];
  } else if (!modelData.live) {
    state = COVERAGE_STATES.VISITED;
    assertions = [...assertions, assertion(
      'liveTierSkipped',
      true,
      'tier live sem dados para esta tabela',
      { informational: true },
    )];
  } else {
    const liveResult = applyExemption(evaluateLiveAssertions(modelData, modelData.live), exemption, modelData.model);
    const liveAssertions = liveResult.assertions;
    if (liveResult.applied) exemptionApplied = liveResult.applied;
    assertions = [...assertions, ...liveAssertions];
    state = liveAssertions.some((a) => !a.passed) ? COVERAGE_STATES.FAILED : COVERAGE_STATES.VALIDATED;
  }

  const failedAssertions = assertions.filter((a) => !a.passed).map((a) => a.name);
  const warnings = assertions.filter((a) => a.warning).map((a) => a.name);

  return {
    id: modelData.id,
    model: modelData.model,
    table: (parsed && parsed.tableName) || null,
    state,
    assertions,
    failedAssertions,
    warnings,
    ...(exemptionApplied ? { exemptionApplied } : {}),
  };
}

/**
 * Avalia a onda inteira.
 *
 * @param {object} input
 * @param {object[]} input.models dados estáticos (+live) por model
 * @param {boolean} input.dbAvailable
 * @param {string|null} [input.dbUnavailableReason]
 * @param {object} [input.exemptions] isenções justificadas por nome de model
 *   ({ "<Model>": { assertion, reason, approvedBy, date } })
 * @returns {{ waveId, dbAvailable, totals, perModel, exemptions }}
 */
function evaluateDbIntegrityWave({ models = [], dbAvailable = false, dbUnavailableReason = null, exemptions = {} } = {}) {
  const applied = [];
  const ignored = [];
  const perModel = models.map((modelData) => {
    const rawExemption = exemptions[modelData.model];
    let exemption = null;
    if (rawExemption != null) {
      if (isValidExemption(rawExemption)) {
        exemption = rawExemption;
      } else {
        ignored.push({
          model: modelData.model,
          exemption: rawExemption && typeof rawExemption === 'object' ? rawExemption : {},
          reason: `campos obrigatórios ausentes ou vazios (${EXEMPTION_REQUIRED_FIELDS.join(', ')})`,
        });
      }
    }
    const entry = evaluateModel(modelData, { dbAvailable, dbUnavailableReason, exemption });
    if (exemption) {
      if (entry.exemptionApplied) applied.push(entry.exemptionApplied);
      else {
        ignored.push({
          model: modelData.model,
          exemption,
          reason: `assertiva '${exemption.assertion}' não existe para este model`,
        });
      }
    }
    return entry;
  });

  const totals = {
    models: perModel.length,
    validated: perModel.filter((m) => m.state === COVERAGE_STATES.VALIDATED).length,
    visited: perModel.filter((m) => m.state === COVERAGE_STATES.VISITED).length,
    failed: perModel.filter((m) => m.state === COVERAGE_STATES.FAILED).length,
    warnings: perModel.filter((m) => m.warnings.length > 0).length,
  };

  return { waveId: WAVE_ID, dbAvailable: Boolean(dbAvailable), totals, perModel, exemptions: { applied, ignored } };
}

module.exports = {
  WAVE_ID,
  evaluateDbIntegrityWave,
  evaluateModel,
  evaluateStaticAssertions,
  evaluateLiveAssertions,
  isValidExemption,
  applyExemption,
  toSnakeCase,
  expectedColumnName,
};
