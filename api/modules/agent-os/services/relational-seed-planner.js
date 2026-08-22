'use strict';

/**
 * Relational Seed Planner — constrói a árvore de dependências de seeds.
 *
 * Usa as associations do Sequelize para inferir a ordem topológica de
 * provisionamento de entidades sintéticas, garantindo:
 *   - FK consistency (parent criado antes do filho)
 *   - Tenant consistency (todos os objetos no mesmo tenant)
 *   - Detecção de ciclos
 *   - Validação final: Schema, FK, Tenant, Unique, NotNull, Enums
 */

const crypto = require('crypto');

// ─── Dependency Graph ─────────────────────────────────────────────────────────

/**
 * Constrói grafo de dependências a partir das associations do Sequelize.
 * @param {object} models — models do Sequelize
 * @returns {{ nodes: string[], edges: Map<string, string[]> }}
 */
function buildDependencyGraph(models) {
  const nodes = Object.keys(models);
  const edges = new Map(); // modelName → [dependsOn...]

  for (const modelName of nodes) {
    edges.set(modelName, []);
  }

  for (const modelName of nodes) {
    const model = models[modelName];
    const associations = model.associations || {};

    for (const [, assoc] of Object.entries(associations)) {
      const assocType = assoc.associationType || assoc.constructor?.name || '';
      const targetName = assoc.target?.name || assoc.targetModel?.name;

      if (!targetName || !nodes.includes(targetName)) continue;

      // belongsTo: modelName DEPENDE de targetName
      if (assocType === 'BelongsTo') {
        if (!edges.get(modelName).includes(targetName)) {
          edges.get(modelName).push(targetName);
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * Topological sort via Kahn's algorithm.
 * Detecta ciclos.
 * @returns {{ order: string[], cycles: string[][] }}
 */
function topologicalSort(nodes, edges) {
  // in-degree = número de dependências que o nó tem (não quantos dependem dele).
  // edges[n] = [deps]: n depende de deps.
  // Nós com in-degree 0 não têm predecessores — são provisionados primeiro.
  const inDegree = new Map(nodes.map((n) => [n, 0]));

  for (const [n, deps] of edges.entries()) {
    // Cada dep em deps é um prerequisito de n. Contamos os prerequisitos de n.
    const uniqueDeps = new Set(deps);
    inDegree.set(n, uniqueDeps.size);
  }

  // Nós com in-degree 0 não dependem de ninguém → são provisionados primeiro
  const queue = nodes.filter((n) => (inDegree.get(n) || 0) === 0);
  const order = [];
  const remaining = new Set(nodes);

  while (queue.length > 0) {
    const node = queue.shift();
    order.push(node);
    remaining.delete(node);

    // Encontrar nós que dependem deste e decrementar in-degree
    for (const [n, deps] of edges.entries()) {
      if (deps.includes(node)) {
        const newDegree = (inDegree.get(n) || 0) - 1;
        inDegree.set(n, newDegree);
        if (newDegree === 0 && remaining.has(n)) {
          queue.push(n);
        }
      }
    }
  }

  const cycles = remaining.size > 0
    ? detectCycles([...remaining], edges)
    : [];

  return { order, cycles };
}

function detectCycles(remaining, edges) {
  // Simplificado: reportar os nós que formam ciclos
  const cycles = [];
  const visited = new Set();

  function dfs(node, path, pathSet) {
    if (pathSet.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    pathSet.add(node);
    path.push(node);
    for (const dep of edges.get(node) || []) {
      if (remaining.includes(dep) || remaining.includes(dep)) {
        dfs(dep, [...path], new Set(pathSet));
      }
    }
  }

  for (const node of remaining) {
    dfs(node, [], new Set());
  }

  return cycles;
}

// ─── Seed Plan Builder ───────────────────────────────────────────────────────

/**
 * Constrói o plano de provisioning para uma jornada sintética.
 * @param {object[]} journeyEntities — entidades necessárias para a jornada
 * @param {object} models — models do Sequelize
 * @param {string} tenantId — tenant do seed
 * @returns {SeedPlan}
 */
function buildSeedPlan(journeyEntities, models, tenantId) {
  const { nodes, edges } = buildDependencyGraph(models);
  const { order, cycles } = topologicalSort(nodes, edges);

  // Filtrar apenas os modelos necessários para a jornada
  const requiredModels = new Set(journeyEntities.map((e) => e.modelName).filter(Boolean));

  // Adicionar dependências transitivas
  function addTransitiveDeps(modelName, visited = new Set()) {
    if (visited.has(modelName)) return;
    visited.add(modelName);
    requiredModels.add(modelName);
    for (const dep of edges.get(modelName) || []) {
      addTransitiveDeps(dep, visited);
    }
  }

  for (const modelName of [...requiredModels]) {
    addTransitiveDeps(modelName);
  }

  // Ordenar conforme topological sort (só modelos necessários)
  const provisionOrder = order.filter((m) => requiredModels.has(m));

  // Construir contexto relacional
  const entityContext = new Map(); // modelName → { model, entity, primaryKey, tenantId, references: {} }

  const provisioningSteps = provisionOrder.map((modelName) => {
    const model = models[modelName];
    const entityDef = journeyEntities.find((e) => e.modelName === modelName);
    const associations = model?.associations || {};
    const attributes = model?.rawAttributes || model?.tableAttributes || {};
    const references = {};

    // Resolver FKs dos parents já provisionados
    for (const [, assoc] of Object.entries(associations)) {
      const assocType = assoc.associationType || assoc.constructor?.name || '';
      const targetName = assoc.target?.name || assoc.targetModel?.name;
      const fkField    = assoc.foreignKey;

      if (assocType === 'BelongsTo' && targetName && fkField) {
        const parentCtx = entityContext.get(targetName);
        if (parentCtx) {
          references[fkField] = `{{${targetName}.${parentCtx.primaryKey}}}`;
        }
      }
    }

    const primaryKey = Object.entries(attributes).find(([, definition]) => definition?.primaryKey)?.[0] || 'id';
    const tenantField = ['tenant_key', 'tenant_id', 'tenantKey', 'tenantId']
      .find((field) => Object.prototype.hasOwnProperty.call(attributes, field)) || null;

    const step = {
      step:         provisionOrder.indexOf(modelName) + 1,
      modelName,
      tenantId,
      references,
      data:         entityDef?.data || {},
      primaryKey,
      tenantField,
    };

    entityContext.set(modelName, {
      model:      modelName,
      primaryKey,
      tenantId,
      references,
    });

    return step;
  });

  return {
    planId:          crypto.randomUUID(),
    tenantId,
    journeyEntities: journeyEntities.map((e) => e.modelName),
    cycles,
    hasCycles:       cycles.length > 0,
    provisionOrder,
    provisioningSteps,
    entityContext:   Object.fromEntries(entityContext),
  };
}

// ─── Seed Validator ───────────────────────────────────────────────────────────

/**
 * Valida o seed final após provisioning.
 * Verifica: Schema, FK, Tenant, Unique, NotNull, Enums, BusinessInvariants.
 */
function resolveReferencedModelName(reference, models) {
  const rawTarget = reference?.model;
  if (!rawTarget) return null;
  if (typeof rawTarget !== 'string') {
    return rawTarget.name || rawTarget.modelName || rawTarget.options?.name?.singular || null;
  }
  if (models[rawTarget]) return rawTarget;
  return Object.entries(models).find(([, model]) => {
    const tableName = model?.tableName || model?.options?.tableName;
    return tableName === rawTarget;
  })?.[0] || rawTarget;
}

function enumValues(definition) {
  if (Array.isArray(definition?.values)) return definition.values;
  if (Array.isArray(definition?.type?.values)) return definition.type.values;
  if (Array.isArray(definition?.type?.options?.values)) return definition.type.options.values;
  return [];
}

function validateSeed(seedData, modelName, models, tenantId, options = {}) {
  const violations = [];
  const model = models[modelName];

  if (!model) {
    return { valid: false, violations: [`Model ${modelName} não encontrado`] };
  }

  const attrs = model.rawAttributes || model.tableAttributes || {};

  // Schema: o seed não pode carregar campos inexistentes no model.
  for (const field of Object.keys(seedData || {})) {
    if (!Object.prototype.hasOwnProperty.call(attrs, field)) {
      violations.push({ check: 'SCHEMA', field, issue: 'campo não declarado no model' });
    }
  }

  // NotNull
  for (const [field, def] of Object.entries(attrs)) {
    const databaseGenerated = def.primaryKey === true
      && (def.autoIncrement === true || def.defaultValue !== undefined || options.allowGeneratedPrimaryKeys !== false);
    if (def.allowNull === false && seedData[field] === undefined && !databaseGenerated) {
      violations.push({ check: 'NOT_NULL', field, issue: 'campo obrigatório ausente' });
    }
  }

  // Tenant consistency
  const tenantFields = ['tenant_key', 'tenant_id', 'tenantKey', 'tenantId'];
  for (const tf of tenantFields) {
    if (seedData[tf] !== undefined && seedData[tf] !== tenantId) {
      violations.push({
        check:    'SEED_TENANT_VIOLATION',
        field:    tf,
        expected: tenantId,
        got:      seedData[tf],
      });
    }
  }

  // FK existence (detectar __FK_UNRESOLVED__)
  for (const [field, value] of Object.entries(seedData)) {
    if (value === '__FK_UNRESOLVED__') {
      violations.push({ check: 'FK_EXISTENCE', field, issue: 'FK não resolvida' });
    }
  }

  // FK target: quando o parent já foi provisionado, o valor precisa apontar
  // exatamente para a PK capturada, nunca para um UUID inventado.
  for (const [field, def] of Object.entries(attrs)) {
    if (!def?.references || seedData[field] === undefined || seedData[field] === '__FK_UNRESOLVED__') continue;
    const targetName = resolveReferencedModelName(def.references, models);
    const target = targetName ? options.resolvedEntities?.[targetName] : null;
    if (target) {
      const targetKey = def.references.key || 'id';
      const expected = target[targetKey];
      if (expected === undefined) {
        violations.push({ check: 'FK_EXISTENCE', field, targetModel: targetName, issue: `target key ${targetKey} ausente` });
      } else if (seedData[field] !== expected) {
        violations.push({ check: 'FK_TARGET', field, targetModel: targetName, expected, got: seedData[field] });
      }
    } else if (options.requireResolvedForeignKeys === true) {
      violations.push({ check: 'FK_EXISTENCE', field, targetModel: targetName, issue: 'target não provisionado' });
    }
  }

  // Enum constraints.
  for (const [field, def] of Object.entries(attrs)) {
    const allowed = enumValues(def);
    if (allowed.length > 0 && seedData[field] !== undefined && !allowed.includes(seedData[field])) {
      violations.push({ check: 'ENUM', field, allowed, got: seedData[field] });
    }
  }

  // Unique dentro do provisioning atual. A constraint do banco continua sendo
  // a autoridade final para concorrência/outros registros.
  const seenUnique = options.seenUnique;
  if (seenUnique instanceof Map) {
    for (const [field, def] of Object.entries(attrs)) {
      if (def?.unique !== true || seedData[field] === undefined) continue;
      const key = `${modelName}.${field}:${JSON.stringify(seedData[field])}`;
      if (seenUnique.has(key)) {
        violations.push({ check: 'UNIQUE', field, got: seedData[field], issue: 'valor duplicado no seed plan' });
      } else {
        seenUnique.set(key, true);
      }
    }
  }

  for (const validator of options.businessValidators || []) {
    const result = validator({ seedData, modelName, models, tenantId, options });
    if (result === true || result === undefined || result === null) continue;
    violations.push(typeof result === 'object'
      ? { check: 'BUSINESS_INVARIANT', ...result }
      : { check: 'BUSINESS_INVARIANT', issue: String(result) });
  }

  return {
    valid:      violations.length === 0,
    violations,
    status:     violations.length === 0 ? 'SEED_VALIDATED' : 'SEED_INVALID',
  };
}

function resolveReferenceTemplate(value, provisionedEntities) {
  if (typeof value !== 'string') return { resolved: true, value };
  const match = /^\{\{([^.}]+)\.([^.}]+)\}\}$/.exec(value);
  if (!match) return { resolved: true, value };
  const [, modelName, key] = match;
  const target = provisionedEntities[modelName];
  if (!target || target[key] === undefined || target[key] === null) {
    return { resolved: false, modelName, key, value: null };
  }
  return { resolved: true, modelName, key, value: target[key] };
}

function plainRecord(record) {
  if (!record) return null;
  if (typeof record.get === 'function') return record.get({ plain: true });
  if (typeof record.toJSON === 'function') return record.toJSON();
  return { ...record };
}

/**
 * Executa um SeedPlan contra os models reais em ordem topológica. Parents são
 * criados primeiro; suas PKs retornadas pelo banco alimentam as FKs dos filhos.
 */
async function provisionSeedPlan(seedPlan, models, options = {}) {
  const violations = [];
  const provisionedEntities = {};
  const seenUnique = new Map();
  const steps = Array.isArray(seedPlan?.provisioningSteps) ? seedPlan.provisioningSteps : [];

  if (!seedPlan || seedPlan.hasCycles === true || (seedPlan.cycles || []).length > 0) {
    return {
      valid: false,
      status: 'SEED_INVALID',
      violations: [{ check: 'CYCLE', issue: 'seed plan contém ciclo relacional' }],
      provisionedEntities,
    };
  }

  // Preflight completo antes da primeira escrita: schema, tenant, enum, not-null
  // e invariantes que não dependem de IDs provisionados.
  for (const step of steps) {
    const preflightData = { ...(step.data || {}), ...(step.references || {}) };
    if (step.tenantField && preflightData[step.tenantField] === undefined) {
      preflightData[step.tenantField] = seedPlan.tenantId;
    }
    const preflight = validateSeed(preflightData, step.modelName, models, seedPlan.tenantId, {
      allowGeneratedPrimaryKeys: true,
      businessValidators: options.businessValidators,
    });
    violations.push(...preflight.violations);
  }
  if (violations.length > 0) {
    return { valid: false, status: 'SEED_INVALID', violations, provisionedEntities };
  }

  for (const step of steps) {
    const model = models[step.modelName];
    if (!model || typeof model.create !== 'function') {
      violations.push({ check: 'MODEL_CREATE', modelName: step.modelName, issue: 'model.create indisponível' });
      break;
    }

    const data = { ...(step.data || {}) };
    if (step.tenantField && data[step.tenantField] === undefined) data[step.tenantField] = seedPlan.tenantId;
    for (const [field, template] of Object.entries(step.references || {})) {
      const resolved = resolveReferenceTemplate(template, provisionedEntities);
      if (!resolved.resolved) {
        violations.push({
          check: 'FK_EXISTENCE',
          field,
          targetModel: resolved.modelName,
          issue: `parent ${resolved.modelName}.${resolved.key} não provisionado`,
        });
        continue;
      }
      data[field] = resolved.value;
    }
    if (violations.length > 0) break;

    const validation = validateSeed(data, step.modelName, models, seedPlan.tenantId, {
      allowGeneratedPrimaryKeys: true,
      requireResolvedForeignKeys: true,
      resolvedEntities: provisionedEntities,
      seenUnique,
      businessValidators: options.businessValidators,
    });
    if (!validation.valid) {
      violations.push(...validation.violations);
      break;
    }

    try {
      const created = plainRecord(await model.create(data, options.transaction ? { transaction: options.transaction } : undefined));
      const primaryKey = step.primaryKey || 'id';
      if (!created || created[primaryKey] === undefined || created[primaryKey] === null) {
        violations.push({ check: 'PRIMARY_KEY', modelName: step.modelName, field: primaryKey, issue: 'PK não retornada pelo banco' });
        break;
      }
      provisionedEntities[step.modelName] = created;
    } catch (error) {
      violations.push({ check: 'PERSISTENCE', modelName: step.modelName, issue: error.message });
      break;
    }
  }

  return {
    valid: violations.length === 0 && Object.keys(provisionedEntities).length === steps.length,
    status: violations.length === 0 && Object.keys(provisionedEntities).length === steps.length
      ? 'SEED_READY'
      : 'SEED_INVALID',
    violations,
    provisionedEntities,
    provisionedCount: Object.keys(provisionedEntities).length,
  };
}

// ─── Síntese de exemplo para journey ─────────────────────────────────────────
//
// TEST_FIXTURE_ONLY — uso exclusivo em testes unitários.
// PROIBIDO usar como evidência de governança ou em scripts de validação.
// Para planos de seed reais, usar buildSeedPlan() com models do Sequelize.

/**
 * Gera um plano de seed sintético de exemplo para uso em testes unitários.
 * @see buildSeedPlan para uso em produção (requer Sequelize models)
 */
function synthesizeExampleSeedPlan(journeyId, tenantId) {
  // Grafo de dependência canônica do domínio fitness (exemplo)
  const canonicalDependencyOrder = [
    'Tenant',
    'Establishment',
    'Professional',
    'Service',
    'Resource',
    'Customer',
    'Appointment',
  ];

  const entityContext = {};
  let prevId = null;
  let prevModel = null;

  const provisioningSteps = canonicalDependencyOrder.map((modelName, idx) => {
    const id = crypto.randomUUID();
    const references = {};

    // Simular FK do parent
    if (prevModel && prevId) {
      references[`${prevModel.toLowerCase()}_id`] = prevId;
    }
    if (modelName !== 'Tenant') {
      references['tenant_key'] = tenantId;
    }

    entityContext[modelName] = { model: modelName, primaryKey: 'id', id, tenantId };

    const step = {
      step:      idx + 1,
      modelName,
      tenantId:  modelName === 'Tenant' ? null : tenantId,
      primaryKey: id,
      references,
      tenantConsistent: true,
      validationStatus: 'SEED_VALIDATED',
    };

    prevId    = id;
    prevModel = modelName;
    return step;
  });

  return {
    planId:          crypto.randomUUID(),
    journeyId,
    tenantId,
    generatedAt:     new Date().toISOString(),
    provisionOrder:  canonicalDependencyOrder,
    provisioningSteps,
    entityContext,
    hasCycles:       false,
    cycles:          [],
    status:          'SEED_PLAN_READY',
    validationSummary: {
      schemaValidation:   'PASS',
      fkExistence:        'PASS',
      tenantConsistency:  'PASS',
      uniqueConstraints:  'PASS',
      notNull:            'PASS',
      enums:              'PASS',
      businessInvariants: 'PASS',
    },
  };
}

module.exports = {
  buildDependencyGraph,
  topologicalSort,
  buildSeedPlan,
  provisionSeedPlan,
  validateSeed,
  synthesizeExampleSeedPlan,
};
