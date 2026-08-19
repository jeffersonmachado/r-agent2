'use strict';

/**
 * Model Introspection Service
 *
 * Carrega todos os models Sequelize de api/db/models/
 * Extrai: modelName, tableName, attributes, constraints, FK, PK, indexes,
 * associations, JSONB fields, status fields, lifecycle fields, timestamps.
 *
 * FKs são detectadas APENAS por metadata real do Sequelize
 * (`attrMeta.references` ou associação BelongsTo) — nunca por sufixo de nome.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MODELS_DIR = path.join(__dirname, '..', '..', '..', '..', 'api', 'db', 'models');

function nowIso() { return new Date().toISOString(); }
function makeHash(input) { return crypto.createHash('sha256').update(String(input)).digest('hex'); }

/**
 * Extrai campos de status comuns (status, state, lifecycle, stage, phase).
 */
function extractStatusFields(attributes) {
  const statusFields = {};
  for (const [name, def] of Object.entries(attributes)) {
    const normalized = name.toLowerCase();
    if (normalized === 'status' || normalized === 'state' || normalized === 'lifecycle' ||
        normalized === 'stage' || normalized === 'phase' || normalized.endsWith('_status')) {
      statusFields[name] = {
        type: String(def.type || 'STRING'),
        allowNull: def.allowNull !== false,
        defaultValue: def.defaultValue || null,
      };
    }
  }
  return statusFields;
}

/**
 * Extrai campos JSONB de um model.
 */
function extractJsonbFields(attributes) {
  const jsonbFields = {};
  for (const [name, def] of Object.entries(attributes)) {
    const typeKey = def.type?.key || String(def.type || '');
    if (typeKey === 'JSONB' || typeKey === 'JSON') {
      jsonbFields[name] = {
        allowNull: def.allowNull !== false,
        defaultValue: def.defaultValue || null,
      };
    }
  }
  return jsonbFields;
}

/**
 * Extrai campos de lifecycle (created_at, updated_at, deleted_at, etc.).
 */
function extractLifecycleFields(attributes) {
  const lifecycleFields = {};
  const lifecycleNames = ['created_at', 'updated_at', 'deleted_at', 'archived_at',
    'published_at', 'activated_at', 'deactivated_at', 'expires_at', 'completed_at'];
  for (const [name, def] of Object.entries(attributes)) {
    if (lifecycleNames.includes(name) || name.endsWith('_at')) {
      lifecycleFields[name] = {
        type: String(def.type || 'DATE'),
        allowNull: def.allowNull !== false,
      };
    }
  }
  return lifecycleFields;
}

/**
 * Normaliza `references` do Sequelize ({ model: 'tabela'|Model, key }) para
 * { model, table, key }. Retorna null quando não há referência real declarada.
 */
function normalizeReferences(references) {
  if (!references || typeof references !== 'object') return null;
  const model = references.model;
  if (!model) return null;
  if (typeof model === 'string') return { model, table: model, key: references.key || 'id' };
  // references.model pode ser a classe do Model Sequelize
  const modelName = model.modelName || model.name || null;
  const tableName = model.tableName || (model.options && model.options.tableName) || null;
  if (!modelName && !tableName) return null;
  return { model: modelName || tableName, table: tableName, key: references.key || 'id' };
}

/**
 * Extrai FKs reais das associações Sequelize carregadas (model.associations).
 * Apenas BelongsTo introduz FK no model local; demais tipos vivem no target
 * ou em tabela de junção e não são FK local.
 */
function extractAssociationForeignKeys(model) {
  const associations = model && model.associations;
  if (!associations || typeof associations !== 'object') return [];
  const fks = [];
  for (const assoc of Object.values(associations)) {
    if (!assoc || assoc.associationType !== 'BelongsTo') continue;
    const fkField = typeof assoc.foreignKey === 'string'
      ? assoc.foreignKey
      : (assoc.foreignKey && (assoc.foreignKey.fieldName || assoc.foreignKey.name)) || null;
    const target = assoc.target;
    const referencedModel = (target && (target.name || (target.options && target.options.name && target.options.name.singular))) || null;
    if (fkField && referencedModel) {
      fks.push({ fkField, referencedModel, as: assoc.as || null });
    }
  }
  return fks;
}

/**
 * Detecta foreign keys por metadata REAL do Sequelize — nunca por sufixo de
 * nome: um campo `owner` com `references` declarado É uma FK; um campo
 * `xyz_id` sem `references` e sem associação BelongsTo NÃO é.
 *
 * Fontes aceitas (ambas reais):
 *   1. attrMeta.references (DataTypes attribute references)
 *   2. model.associations[*] com associationType 'BelongsTo'
 */
function detectForeignKeyFields(attributes, primaryKeys, associationFks = []) {
  const fks = {};
  for (const [name, def] of Object.entries(attributes)) {
    if (primaryKeys.includes(name)) continue;
    const refs = normalizeReferences(def.references);
    if (refs && refs.model) {
      fks[name] = {
        referencedModel: refs.model,
        referencedTable: refs.table || null,
        referencedKey: refs.key,
        allowNull: def.allowNull !== false,
        source: 'sequelize_references',
      };
    }
  }
  for (const assoc of associationFks) {
    if (fks[assoc.fkField]) {
      fks[assoc.fkField].source = 'sequelize_references+association';
      continue;
    }
    fks[assoc.fkField] = {
      referencedModel: assoc.referencedModel,
      referencedTable: null,
      referencedKey: 'id',
      allowNull: attributes[assoc.fkField] ? attributes[assoc.fkField].allowNull !== false : true,
      source: 'sequelize_association',
      as: assoc.as || null,
    };
  }
  return fks;
}

/**
 * Detecta campos enum (type é STRING com valores limitados por contexto).
 */
function detectEnumFields(attributes) {
  const enums = {};
  // Enum patterns conhecidos nos models RAP
  const knownEnums = {
    status: ['Ticket', 'Order', 'Delivery', 'ChannelConversation', 'ResourceBooking', 'FlowExecution',
      'Project', 'ProjectItem', 'CcCampaign', 'PhysicalTicket', 'BillingSubscription'],
    channel_type: ['ChannelConversation', 'ChannelMessage', 'Ticket'],
    mode: ['Ticket'],
    kind: ['Schedule'],
    classification: ['CorporateAgent'],
    lifecycle: ['CorporateAgent'],
    source: ['Order'],
    eventType: ['AiGovernanceRecord', 'AuditEvent'],
  };

  for (const [name, def] of Object.entries(attributes)) {
    const typeKey = def.type?.key || String(def.type || '');
    // Valores enum conhecidos pelo código
    if (def.values && Array.isArray(def.values)) {
      enums[name] = { values: def.values };
    }
  }
  return enums;
}

/**
 * Extrai primary keys.
 */
function extractPrimaryKeys(attributes) {
  const pks = [];
  for (const [name, def] of Object.entries(attributes)) {
    if (def.primaryKey) pks.push(name);
  }
  return pks;
}

/**
 * Extrai indexes da definição do model.
 */
function extractIndexes(modelDef) {
  const indexes = [];
  if (modelDef.options?.indexes && Array.isArray(modelDef.options.indexes)) {
    for (const idx of modelDef.options.indexes) {
      indexes.push({
        fields: idx.fields || [],
        name: idx.name || null,
        unique: idx.unique || false,
      });
    }
  }
  return indexes;
}

/**
 * Carrega um model Sequelize e extrai metadados.
 */
function introspectModel(requirePath, modelName) {
  try {
    const getModel = require(requirePath);
    if (typeof getModel !== 'function') return null;

    let model;
    try {
      model = getModel();
    } catch (_) {
      return introspectModelFromSource(requirePath, modelName);
    }

    if (!model) return introspectModelFromSource(requirePath, modelName);

    // Se é Proxy (Sequelize não inicializado), rawAttributes lança exceção
    let attributes;
    try {
      attributes = model.rawAttributes || {};
      // Testa se é Proxy: acessar qualquer chave pode lançar
      if (Object.keys(attributes).length === 0 && typeof model.tableName === 'undefined') {
        return introspectModelFromSource(requirePath, modelName);
      }
    } catch (_) {
      return introspectModelFromSource(requirePath, modelName);
    }

    if (!attributes || Object.keys(attributes).length === 0) {
      return introspectModelFromSource(requirePath, modelName);
    }

    const attrMeta = {};

    for (const [name, def] of Object.entries(attributes)) {
      const typeKey = def.type?.key || String(def.type || 'UNKNOWN');
      attrMeta[name] = {
        type: typeKey,
        allowNull: def.allowNull !== false,
        defaultValue: def.defaultValue !== undefined ? def.defaultValue : null,
        primaryKey: def.primaryKey === true,
        autoIncrement: def.autoIncrement === true,
        unique: def.unique === true,
        references: def.references || null,
      };
    }

    const primaryKeys = extractPrimaryKeys(attributes);
    const associationFks = extractAssociationForeignKeys(model);
    const foreignKeys = detectForeignKeyFields(attrMeta, primaryKeys, associationFks);

    return {
      modelName,
      tableName: model.tableName || modelName.toLowerCase() + 's',
      attributes: attrMeta,
      primaryKeys,
      foreignKeys,
      associations: associationFks,
      indexes: extractIndexes(model),
      statusFields: extractStatusFields(attributes),
      jsonbFields: extractJsonbFields(attributes),
      lifecycleFields: extractLifecycleFields(attributes),
      enumFields: detectEnumFields(attributes),
      hasTimestamps: model.options?.timestamps !== false,
      totalAttributes: Object.keys(attrMeta).length,
      totalRequired: Object.values(attrMeta).filter(a => !a.allowNull && a.defaultValue === null).length,
    };
  } catch (err) {
    return { modelName, error: err.message, source: 'parse_error' };
  }
}

/**
 * Fallback: faz parse do source code do model para extrair atributos.
 */
function introspectModelFromSource(requirePath, modelName) {
  try {
    const source = fs.readFileSync(requirePath, 'utf8');
    const attributes = {};

    // Estratégia 1: sequelize.define('ModelName', { ... }, { ...options })
    const defineMatch = source.match(/\.define\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*?\})\s*(?:,\s*(\{[\s\S]*?\})\s*)?\)/);
    let attrBlock = null;
    let optionsBlock = null;

    if (defineMatch) {
      attrBlock = defineMatch[2];
      optionsBlock = defineMatch[3] || null;
    }

    // Estratégia 2: parse manual de campos DataTypes
    if (attrBlock) {
      // Parse cada field: fieldName: { type: DataTypes.X, allowNull: ..., defaultValue: ..., primaryKey: ... }
      const fieldPattern = /(\w+)\s*:\s*\{[^}]*(?:type\s*:\s*DataTypes\.\w+)[^}]*\}/g;
      let fieldMatch;
      while ((fieldMatch = fieldPattern.exec(attrBlock)) !== null) {
        const fieldBody = fieldMatch[0];
        const fieldNameMatch = fieldBody.match(/^(\w+)\s*:/);
        if (!fieldNameMatch) continue;
        const fieldName = fieldNameMatch[1];
        const typeMatch = fieldBody.match(/type\s*:\s*DataTypes\.(\w+)/);
        attributes[fieldName] = {
          type: typeMatch ? typeMatch[1] : 'UNKNOWN',
          allowNull: !fieldBody.includes('allowNull: false'),
          defaultValue: fieldBody.includes('defaultValue:') ? 'has_default' : null,
          primaryKey: fieldBody.includes('primaryKey: true'),
        };
      }
    }

    // Estratégia 3: fallback - parse qualquer pattern { field: { type: ... } }
    if (Object.keys(attributes).length === 0) {
      const genericPattern = /(\w+)\s*:\s*\{\s*type\s*:\s*DataTypes\.(\w+)/g;
      let gm;
      while ((gm = genericPattern.exec(source)) !== null) {
        const fieldName = gm[1];
        if (fieldName === 'id' || fieldName.length > 2) {
          const fieldContext = source.substring(Math.max(0, gm.index - 30), gm.index + 150);
          attributes[fieldName] = {
            type: gm[2],
            allowNull: !fieldContext.includes('allowNull: false'),
            defaultValue: fieldContext.includes('defaultValue:') ? 'has_default' : null,
            primaryKey: fieldContext.includes('primaryKey: true') || fieldName === 'id',
          };
        }
      }
    }

    const primaryKeys = Object.entries(attributes)
      .filter(([, a]) => a.primaryKey)
      .map(([name]) => name);

    if (primaryKeys.length === 0 && attributes.id) {
      attributes.id.primaryKey = true;
      primaryKeys.push('id');
    }

    // FK real via metadata: extrai `references: { model: 'x', key: 'y' }` do
    // source (um nível de chaves aninhadas) e anexa ao atributo já extraído.
    // Campo SEM references declarado nunca vira FK — sufixo _id não é prova.
    const referencesPattern = /(\w+)\s*:\s*\{((?:[^{}]|\{[^{}]*\})*?)references\s*:\s*\{\s*model\s*:\s*['"]([^'"]+)['"]\s*,\s*key\s*:\s*['"]([^'"]+)['"]/g;
    let refsMatch;
    while ((refsMatch = referencesPattern.exec(source)) !== null) {
      const fieldName = refsMatch[1];
      if (attributes[fieldName]) {
        attributes[fieldName].references = { model: refsMatch[3], key: refsMatch[4] };
      } else {
        attributes[fieldName] = {
          type: 'UNKNOWN',
          allowNull: true,
          defaultValue: null,
          primaryKey: false,
          references: { model: refsMatch[3], key: refsMatch[4] },
        };
      }
    }

    const tableNameMatch = source.match(/tableName\s*:\s*['"]([^'"]+)['"]/);
    const hasTimestamps = !source.includes('timestamps: false');

    return {
      modelName,
      tableName: tableNameMatch ? tableNameMatch[1] : modelName.toLowerCase() + 's',
      attributes,
      primaryKeys,
      foreignKeys: detectForeignKeyFields(attributes, primaryKeys),
      indexes: [],
      statusFields: extractStatusFields(attributes),
      jsonbFields: extractJsonbFields(attributes),
      lifecycleFields: extractLifecycleFields(attributes),
      enumFields: {},
      hasTimestamps,
      totalAttributes: Object.keys(attributes).length,
      totalRequired: Object.values(attributes).filter(a => !a.allowNull && a.defaultValue === null).length,
      source: Object.keys(attributes).length > 0 ? 'source_parse' : 'source_parse_minimal',
    };
  } catch (err) {
    return { modelName, error: err.message, source: 'source_parse_error' };
  }
}

/**
 * Carrega e introspecta todos os models.
 */
function introspectAllModels() {
  const models = [];
  const modelFiles = fs.readdirSync(MODELS_DIR)
    .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'helpers.js');

  for (const file of modelFiles) {
    const modelName = file.replace(/\.js$/, '');
    const requirePath = path.join(MODELS_DIR, file);
    const meta = introspectModel(requirePath, modelName);
    if (meta) models.push(meta);
  }

  // Ordena alfabeticamente
  models.sort((a, b) => a.modelName.localeCompare(b.modelName));

  return {
    generatedAt: nowIso(),
    totalModels: models.length,
    modelsLoaded: models.filter(m => !m.error).length,
    modelsWithErrors: models.filter(m => m.error).length,
    models,
  };
}

module.exports = {
  introspectAllModels,
  introspectModel,
  introspectModelFromSource,
  detectForeignKeyFields,
  normalizeReferences,
  extractAssociationForeignKeys,
};
