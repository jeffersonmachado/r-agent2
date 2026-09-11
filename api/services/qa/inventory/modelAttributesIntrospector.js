'use strict';

/**
 * modelAttributesIntrospector — introspecção DETERMINÍSTICA dos atributos reais
 * dos models Sequelize, offline (sem banco, sem `connect()`).
 *
 * Por que existe: o `modelScanner` (regex sobre o texto do arquivo) é suficiente
 * para inventário, mas NÃO é fonte de verdade — ele não lê atributos declarados
 * em múltiplas propriedades na mesma linha, em spreads ou em factories
 * (`createModelFactory` / `getGovernanceModel`). Consequência prática: uma
 * coluna pode existir na migration, ser escrita pelo domínio e NÃO estar no
 * model, e o scanner não percebe.
 *
 * Este módulo elimina a heurística: ele injeta um `sequelize` falso no
 * `require.cache` de `api/db/sequelize.js`, carrega cada arquivo de model e
 * captura exatamente o que o Sequelize receberia em
 * `sequelize.define(name, attributes, options)` — o mesmo objeto que define o
 * que é persistido em runtime.
 *
 * Garantias:
 * - zero I/O de rede/DB; nenhuma conexão é aberta;
 * - determinístico: a mesma árvore produz sempre o mesmo resultado;
 * - o `require.cache` é restaurado ao final (sem efeitos colaterais globais).
 */

const fs = require('fs');
const path = require('path');

const SEQUELIZE_MODULE_PATH = path.join(__dirname, '..', '..', '..', 'db', 'sequelize.js');
const DEFAULT_MODELS_DIR = path.join(__dirname, '..', '..', '..', 'db', 'models');

/** Arquivos que não definem models (espelha o `NON_MODEL_FILES` do scanner). */
const NON_MODEL_FILES = new Set(['index.js', 'helpers.js', 'governanceModelFactory.js']);

/** camelCase/PascalCase → snake_case (tolerante a nomes já snake). */
function toSnakeCase(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/** tableName padrão do Sequelize: pluralização simples (mesma regra da factory). */
function defaultTableName(modelName) {
  return `${modelName.replace(/[A-Z]/g, (letter, index) => `${index ? '_' : ''}${letter.toLowerCase()}`)}s`;
}

/**
 * Cria o `sequelize` falso que captura cada `define()`.
 * Expõe o mínimo que as factories usam (`define`) e falha alto para qualquer
 * outra operação, evitando silenciosamente "passar" um model que na verdade
 * precisaria de banco.
 */
function createCapturingSequelize(capture) {
  return {
    define(modelName, attributes, options = {}) {
      const tableName = options.tableName || defaultTableName(modelName);
      capture.push({ modelName, attributes: attributes || {}, options: options || {}, tableName });
      return {
        name: modelName,
        tableName,
        rawAttributes: attributes || {},
        options,
        getTableName() {
          return tableName;
        },
        associations: {},
        findAll: () => { throw new Error('introspection_only:no_db_operations'); },
        findOne: () => { throw new Error('introspection_only:no_db_operations'); },
      };
    },
    // Alguns models registram hooks/associações fora do define; não são
    // necessários para introspecção de atributos.
    QueryTypes: {},
    Op: {},
  };
}

/**
 * Converte as chamadas `define()` capturadas em um registry de models.
 * Puro — compartilhado entre o caminho CLI (require.cache) e o caminho de teste
 * (Jest com `jest.doMock` do módulo sequelize), garantindo uma única regra.
 */
function buildModelRegistry(captured, { modelsDir = DEFAULT_MODELS_DIR, repoRoot } = {}) {
  const root = repoRoot || path.join(__dirname, '..', '..', '..', '..');
  const models = {};
  for (const entry of captured) {
    const attributes = {};
    for (const [attr, def] of Object.entries(entry.attributes)) {
      const plain = def && typeof def === 'object' ? def : {};
      attributes[attr] = {
        type: plain.type ? String(plain.type.key || plain.type).toUpperCase() : 'UNKNOWN',
        column: plain.field ? String(plain.field) : toSnakeCase(attr),
        primaryKey: Boolean(plain.primaryKey),
        allowNull: plain.allowNull !== false,
        unique: Boolean(plain.unique),
        autoIncrement: Boolean(plain.autoIncrement),
      };
    }
    const primaryKey = Object.entries(attributes).filter(([, a]) => a.primaryKey).map(([a]) => a);
    models[entry.modelName] = {
      modelName: entry.modelName,
      tableName: entry.tableName,
      source: entry.source ? path.relative(root, entry.source) : null,
      attributes,
      physicalColumns: Object.values(attributes).map((a) => a.column),
      primaryKey,
      timestamps: entry.options.timestamps !== false,
      underscored: entry.options.underscored !== false,
    };
  }
  return models;
}

/**
 * Introspecta todos os models de um diretório.
 *
 * @param {object} [options]
 * @param {string} [options.modelsDir] diretório de models (default: api/db/models)
 * @param {string} [options.sequelizeModulePath] caminho do módulo sequelize a substituir
 * @param {string[]} [options.only] nomes de arquivo (com .js) a introspectar
 * @param {Function} [options.loadModel] loader alternativo `(absPath) => factory`.
 *   Usado pelo Jest (que possui registry próprio e não enxerga o `require.cache`
 *   do Node); nesse caso o chamador já substituiu o módulo sequelize via
 *   `jest.doMock` E deve passar em `options.captured` o MESMO array usado para
 *   construir o sequelize falso (`createCapturingSequelize`).
 * @param {object[]} [options.captured] array de captura compartilhado com o
 *   sequelize falso do chamador (obrigatório quando `loadModel` é injetado).
 * @returns {{ models: Record<string, object>, errors: object[], loadedFiles: string[] }}
 *   `models[ModelName] = { modelName, tableName, source, attributes, primaryKey, timestamps, underscored }`
 */
function introspectModels(options = {}) {
  const modelsDir = options.modelsDir || DEFAULT_MODELS_DIR;
  const sequelizeModulePath = options.sequelizeModulePath || SEQUELIZE_MODULE_PATH;
  const only = options.only ? new Set(options.only) : null;
  const injectedLoader = typeof options.loadModel === 'function' ? options.loadModel : null;

  const resolvedSequelize = injectedLoader ? null : require.resolve(sequelizeModulePath);
  const previousSequelizeCache = resolvedSequelize ? require.cache[resolvedSequelize] : null;

  if (injectedLoader && !Array.isArray(options.captured)) {
    throw Object.assign(
      new Error('introspect_models_injected_loader_requires_captured_array'),
      { code: 'captured_array_required' },
    );
  }

  const captured = Array.isArray(options.captured) ? options.captured : [];
  const errors = [];
  const loadedFiles = [];
  const createdModuleKeys = [];

  if (!injectedLoader) {
    const fakeSequelize = createCapturingSequelize(captured);
    // Substitui o módulo sequelize APENAS durante o carregamento dos models.
    require.cache[resolvedSequelize] = {
      id: resolvedSequelize,
      filename: resolvedSequelize,
      loaded: true,
      exports: { getSequelize: () => fakeSequelize, connect: async () => fakeSequelize },
      children: [],
      paths: [],
    };
  }

  try {
    const files = fs.readdirSync(modelsDir)
      .filter((name) => name.endsWith('.js'))
      .filter((name) => !NON_MODEL_FILES.has(name))
      .filter((name) => !only || only.has(name))
      .sort();

    for (const file of files) {
      const abs = path.join(modelsDir, file);
      const before = captured.length;
      try {
        let factory;
        if (injectedLoader) {
          factory = injectedLoader(abs);
        } else {
          const modulePath = require.resolve(abs);
          delete require.cache[modulePath];
          createdModuleKeys.push(modulePath);
          // eslint-disable-next-line global-require, import/no-dynamic-require
          factory = require(abs);
        }
        if (typeof factory !== 'function') {
          errors.push({ file, error: 'model_export_is_not_a_factory' });
          continue;
        }
        factory();
        loadedFiles.push(file);
      } catch (error) {
        errors.push({ file, error: error && error.message ? error.message : String(error) });
        continue;
      }
      if (captured.length === before) {
        errors.push({ file, error: 'define_not_called' });
      }
    }
  } finally {
    if (!injectedLoader) {
      // Restaura o cache original — nenhum outro consumidor deve ver o fake.
      if (previousSequelizeCache) require.cache[resolvedSequelize] = previousSequelizeCache;
      else delete require.cache[resolvedSequelize];
      for (const key of createdModuleKeys) delete require.cache[key];
    }
  }

  return { models: buildModelRegistry(captured, { modelsDir }), errors, loadedFiles };
}

module.exports = {
  introspectModels,
  buildModelRegistry,
  createCapturingSequelize,
  toSnakeCase,
  defaultTableName,
  NON_MODEL_FILES,
  SEQUELIZE_MODULE_PATH,
  DEFAULT_MODELS_DIR,
};
