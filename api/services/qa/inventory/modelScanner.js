'use strict';

/**
 * modelScanner — inventário estático dos modelos Sequelize em `api/db/models/`.
 *
 * Parser próprio por regex + matching de chaves (sem require dos models e sem
 * conexão com o banco). O serviço `model-introspection-service.js` existente
 * foi avaliado e não reutilizado porque seu fallback por regex não extrai
 * `references`, `indexes`, `unique` nem valores ENUM — campos exigidos pelo
 * inventário.
 *
 * Para cada `api/db/models/*.js` com `sequelize.define('Nome', {campos},
 * {opções})` emite:
 *   - `model:<Nome>`                     (um por model)
 *   - `table:<tableName>`                (um por model)
 *   - `field:<Nome>.<campo>`             (um por campo)
 *   - `relation:<Nome>.<campo>-><Ref>.<key>` (um por campo com references)
 *
 * Classification (regra documentada, por tokens do nome do model/tabela):
 *   - tokens qa|test|seed|rpa|demo          → DEVELOPMENT
 *   - tokens audit|log|ledger|diagnostic    → SUPPORT
 *   - demais                                → PRODUCTION
 *
 * Models sem `sequelize.define` literal (ou com campos não literais) são
 * registrados em `warnings` e emitidos com `parseError: true`.
 */

const fs = require('fs');
const path = require('path');

const DEVELOPMENT_TOKENS = new Set(['qa', 'test', 'seed', 'rpa', 'demo']);
const SUPPORT_TOKENS = new Set(['audit', 'log', 'ledger', 'diagnostic']);
const TENANT_FIELD_NAMES = new Set(['tenant_id', 'tenantId', 'tenant_key', 'tenantKey']);

/** Arquivos utilitários do diretório de models que não declaram models. */
const NON_MODEL_FILES = new Set(['index.js', 'helpers.js']);

function classifyModel(modelName, tableName) {
  const tokens = `${modelName || ''} ${tableName || ''}`
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_/-]+/)
    .filter(Boolean);
  if (tokens.some((t) => DEVELOPMENT_TOKENS.has(t))) return 'DEVELOPMENT';
  if (tokens.some((t) => SUPPORT_TOKENS.has(t))) return 'SUPPORT';
  return 'PRODUCTION';
}

function matchDelimiter(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Itera pares `chave: {bloco}` de nível superior de um objeto literal. */
function iterateObjectEntries(objectLiteralBody) {
  const entries = [];
  const re = /([A-Za-z_$][\w$]*)\s*:\s*\{/g;
  let match;
  while ((match = re.exec(objectLiteralBody)) !== null) {
    const openBrace = objectLiteralBody.indexOf('{', match.index + match[0].length - 1);
    const closeBrace = matchDelimiter(objectLiteralBody, openBrace, '{', '}');
    if (closeBrace === -1) continue;
    entries.push({ key: match[1], body: objectLiteralBody.slice(openBrace + 1, closeBrace) });
    re.lastIndex = closeBrace + 1;
  }
  return entries;
}

function parseField(body) {
  const typeMatch = /\btype\s*:\s*DataTypes\.([A-Z]+)\s*(?:\(([^)]*)\))?/.exec(body);
  const field = {
    type: typeMatch ? typeMatch[1] : 'UNKNOWN',
    allowNull: /\ballowNull\s*:\s*false\b/.test(body) ? false
      : (/\ballowNull\s*:\s*true\b/.test(body) ? true : null),
    default: null,
    primaryKey: /\bprimaryKey\s*:\s*true\b/.test(body),
    unique: /\bunique\s*:\s*(true|'[^']*'|"[^"]*")/.test(body),
  };
  const defaultMatch = /\bdefaultValue\s*:\s*(\{[^}]*\}|\[[^\]]*\]|'[^']*'|"[^"]*"|[^,}\n]+)/.exec(body);
  if (defaultMatch) field.default = defaultMatch[1].trim();
  const columnMatch = /\bfield\s*:\s*'([^']+)'/.exec(body);
  if (columnMatch) field.column = columnMatch[1];
  if (field.type === 'ENUM' && typeMatch && typeMatch[2]) {
    field.enumValues = [...typeMatch[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  const refMatch = /\breferences\s*:\s*\{\s*model\s*:\s*('([^']+)'|[A-Za-z_$][\w$]*)\s*,\s*key\s*:\s*'([^']+)'/.exec(body);
  if (refMatch) {
    field.references = { model: refMatch[2] || refMatch[1], key: refMatch[3] };
  }
  return field;
}

function parseIndexes(optionsBody) {
  const anchor = /\bindexes\s*:\s*\[/.exec(optionsBody);
  if (!anchor) return [];
  const openBracket = optionsBody.indexOf('[', anchor.index);
  const closeBracket = matchDelimiter(optionsBody, openBracket, '[', ']');
  if (closeBracket === -1) return [];
  const body = optionsBody.slice(openBracket + 1, closeBracket);
  const indexes = [];
  for (const entry of iterateObjectEntries0(body)) {
    const fieldsMatch = /\bfields\s*:\s*\[([^\]]*)\]/.exec(entry);
    const nameMatch = /\bname\s*:\s*'([^']+)'/.exec(entry);
    indexes.push({
      fields: fieldsMatch ? [...fieldsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [],
      name: nameMatch ? nameMatch[1] : null,
      unique: /\bunique\s*:\s*true/.test(entry),
    });
  }
  return indexes;
}

/** Objetos `{ ... }` de nível superior dentro de um array literal. */
function iterateObjectEntries0(arrayBody) {
  const blocks = [];
  const re = /\{/g;
  let match;
  while ((match = re.exec(arrayBody)) !== null) {
    const closeBrace = matchDelimiter(arrayBody, match.index, '{', '}');
    if (closeBrace === -1) continue;
    blocks.push(arrayBody.slice(match.index + 1, closeBrace));
    re.lastIndex = closeBrace + 1;
  }
  return blocks;
}

function camelToSnakePlural(modelName) {
  const snake = String(modelName).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return snake.endsWith('s') ? snake : `${snake}s`;
}

function parseModelFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const fallbackName = path.basename(filePath, '.js');
  // Dois padrões de fábrica no diretório: sequelize.define('Nome', ...) direto
  // (inclui variações como getSequelize().define) e createModelFactory('Nome', ...)
  // de api/db/models/helpers.js.
  const defineMatch = /(?:\.define|\bcreateModelFactory)\s*\(\s*'([^']+)'/.exec(source);
  if (!defineMatch) {
    return { modelName: fallbackName, parseError: true };
  }
  const modelName = defineMatch[1];
  const openParen = source.indexOf('(', defineMatch.index);
  const closeParen = matchDelimiter(source, openParen, '(', ')');
  if (closeParen === -1) {
    return { modelName, parseError: true };
  }
  const args = splitTopLevel(source.slice(openParen + 1, closeParen));
  if (args.length < 2 || !args[1].startsWith('{')) {
    return { modelName, parseError: true };
  }

  const fieldsBody = args[1].slice(1, -1);
  const fields = {};
  for (const entry of iterateObjectEntries(fieldsBody)) {
    fields[entry.key] = parseField(entry.body);
  }

  let tableName = null;
  let indexes = [];
  if (args.length >= 3 && args[2].startsWith('{')) {
    const optionsBody = args[2].slice(1, -1);
    const tableMatch = /\btableName\s*:\s*'([^']+)'/.exec(optionsBody);
    tableName = tableMatch ? tableMatch[1] : null;
    indexes = parseIndexes(optionsBody);
  }
  if (!tableName) tableName = camelToSnakePlural(modelName);

  const fieldEntries = Object.entries(fields);
  const hasTenantId = fieldEntries.some(([name, field]) => TENANT_FIELD_NAMES.has(name)
    || (field.column && TENANT_FIELD_NAMES.has(field.column)));

  return {
    modelName,
    tableName,
    fields,
    indexes,
    hasTenantId,
    parseError: false,
  };
}

/**
 * @param {{ rootDir?: string, modelsDir?: string }} options
 * @returns {{ items: object[], warnings: string[] }}
 */
function scanModels({ rootDir, modelsDir } = {}) {
  const dir = modelsDir || path.join(rootDir, 'api', 'db', 'models');
  if (!fs.existsSync(dir)) {
    throw new Error(`diretório de models não encontrado: ${dir}`);
  }
  const items = [];
  const warnings = [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !NON_MODEL_FILES.has(f)).sort();
  for (const file of files) {
    const filePath = path.join(dir, file);
    const parsed = parseModelFile(filePath);
    const source = path.join('api', 'db', 'models', file);
    if (parsed.parseError) {
      warnings.push(`sem sequelize.define literal: ${source}`);
      items.push({
        id: `model:${parsed.modelName}`,
        kind: 'model',
        model: parsed.modelName,
        tableName: null,
        fieldCount: 0,
        hasTenantId: false,
        parseError: true,
        classification: classifyModel(parsed.modelName, null),
        source,
      });
      continue;
    }

    const classification = classifyModel(parsed.modelName, parsed.tableName);
    const fieldNames = Object.keys(parsed.fields).sort();

    items.push({
      id: `model:${parsed.modelName}`,
      kind: 'model',
      model: parsed.modelName,
      tableName: parsed.tableName,
      fieldCount: fieldNames.length,
      hasTenantId: parsed.hasTenantId,
      classification,
      source,
    });

    items.push({
      id: `table:${parsed.tableName}`,
      kind: 'table',
      table: parsed.tableName,
      model: parsed.modelName,
      hasTenantId: parsed.hasTenantId,
      indexes: parsed.indexes,
      classification,
      source,
    });

    for (const fieldName of fieldNames) {
      const field = parsed.fields[fieldName];
      items.push({
        id: `field:${parsed.modelName}.${fieldName}`,
        kind: 'field',
        model: parsed.modelName,
        field: fieldName,
        type: field.type,
        allowNull: field.allowNull,
        default: field.default,
        primaryKey: field.primaryKey,
        unique: field.unique,
        ...(field.column ? { column: field.column } : {}),
        ...(field.enumValues ? { enumValues: field.enumValues } : {}),
        classification,
        source,
      });
      if (field.references) {
        items.push({
          id: `relation:${parsed.modelName}.${fieldName}->${field.references.model}.${field.references.key}`,
          kind: 'relation',
          model: parsed.modelName,
          field: fieldName,
          references: field.references,
          classification,
          source,
        });
      }
    }
  }

  return { items, warnings };
}

module.exports = { scanModels, parseModelFile, classifyModel };
