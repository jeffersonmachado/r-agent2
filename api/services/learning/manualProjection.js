'use strict';

/**
 * manualProjection — fronteira FORMAL entre o modelo INTERNO do manual
 * (`InternalManualMetadata`, com replay/selector/trace/evidência) e o modelo
 * PRODUCTION entregue ao operador (`ProductionManualDTO`).
 *
 * PROBLEMA (missão corretiva L1–L3): a API servia o `metadata.json` interno
 * direto para o cliente (`GET /api/learning/manuals` devolvia `replayId` e
 * `steps[].selector`) e o PDF era montado do mesmo objeto interno — imprimindo
 * `Fonte: replay real <id>`, `alvo <code>#selector</code>` e
 * `falhou no replay`. Não havia PROJEÇÃO: o objeto interno ERA a resposta.
 *
 * REGRA: o conteúdo PRODUCTION só existe como resultado de uma projeção
 * explícita (`toProductionManualMetadata` / `toProductionManualStep`), e a
 * projeção é verificada por uma allowlist de chaves + varredura de texto com o
 * mesmo detector do `manualSanitizer`. Qualquer chave desconhecida — inclusive
 * as internas, que são muitas — derruba com erro tipado. Os dois modelos não
 * podem ser confundidos: cada um carrega um `shape` próprio e o assert de
 * produção recusa qualquer coisa que não seja um `ProductionManualDTO`.
 *
 * Este módulo é PURO (zero I/O) para ser usado em gerador, API, PDF, RAG e gate.
 */

const {
  detectProductionLeaks, assertProductionClean,
} = require('./manualSanitizer');

/** Marcador de forma: identifica inequivocamente cada modelo. */
const INTERNAL_MANUAL_SHAPE = 'INTERNAL_MANUAL_METADATA';
const PRODUCTION_MANUAL_SHAPE = 'PRODUCTION_MANUAL_DTO';

const PRODUCTION_MANUAL_DTO_VERSION = '1.0.0';

/**
 * Allowlist ESTRITA do DTO de produção. Não é "blocklist de campos conhecidos":
 * é a lista completa do que pode existir. `replayId`, `selector`, `success`,
 * `uiTrace`, `evidence`, `adapter`, `timeoutMs` etc. não estão aqui — e é
 * exatamente por isso que um objeto interno passado por engano falha.
 */
const PRODUCTION_MANUAL_KEYS = Object.freeze([
  'shape',
  'dtoVersion',
  'id',
  'title',
  'journeyKey',
  'createdAt',
  'stepCount',
  'imageCount',
  'version',
  'contentType',
  'redactions',
  'steps',
]);

const PRODUCTION_STEP_KEYS = Object.freeze([
  'order',
  'name',
  'label',
  'value',
  'image',
  'completed',
]);

/** Linguagem OPERACIONAL: "não concluído", nunca "falhou no replay". */
const COMPLETED_LABEL = 'passo não concluído';

class ProductionManualLeakError extends Error {
  constructor(message, findings) {
    super(message);
    this.name = 'ProductionManualLeakError';
    this.code = 'PRODUCTION_MANUAL_LEAK';
    this.findings = findings || [];
  }
}

function toPlainStep(step) {
  const source = step && typeof step === 'object' ? step : {};
  return {
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : 0,
    name: String(source.name ?? ''),
    label: String(source.label ?? ''),
    value: source.value === undefined || source.value === null ? null : String(source.value),
    image: source.image ? String(source.image) : null,
    // Resultado OPERACIONAL do passo. O flag técnico (`success`) é traduzido,
    // nunca repassado: o operador lê "passo não concluído", não "falhou no
    // replay". Quando o passo já é de produção (`completed` presente), o valor
    // é preservado — assim a projeção é idempotente.
    completed: source.completed !== undefined
      ? source.completed !== false
      : source.success !== false,
  };
}

/**
 * Projeta um passo INTERNO no passo PRODUCTION. Somente campos operacionais.
 * @param {Object} internalStep
 */
function toProductionManualStep(internalStep) {
  return toPlainStep(internalStep);
}

/**
 * Projeta `InternalManualMetadata` → `ProductionManualDTO`.
 *
 * Não é um `delete` de campos proibidos: é construção por allowlist. O que não
 * é explicitamente copiado aqui não existe no resultado.
 *
 * @param {Object} internalMetadata - metadata.json interno do manual
 * @returns {Object} ProductionManualDTO
 */
function toProductionManualMetadata(internalMetadata) {
  const meta = internalMetadata && typeof internalMetadata === 'object' ? internalMetadata : {};
  const steps = Array.isArray(meta.steps) ? meta.steps.map(toPlainStep) : [];

  const dto = {
    shape: PRODUCTION_MANUAL_SHAPE,
    dtoVersion: PRODUCTION_MANUAL_DTO_VERSION,
    id: String(meta.id || ''),
    title: String(meta.title || ''),
    journeyKey: meta.journeyKey ? String(meta.journeyKey) : null,
    createdAt: meta.createdAt ? String(meta.createdAt) : null,
    stepCount: Number.isFinite(Number(meta.stepCount)) ? Number(meta.stepCount) : steps.length,
    imageCount: Number.isFinite(Number(meta.imageCount))
      ? Number(meta.imageCount)
      : steps.filter((step) => step.image).length,
    version: Number.isFinite(Number(meta.version)) ? Number(meta.version) : 1,
    contentType: 'manual',
    redactions: Number.isFinite(Number(meta.redactions)) ? Number(meta.redactions) : 0,
    steps,
  };

  return dto;
}

/** `true` quando o valor é um `ProductionManualDTO` (e não o modelo interno). */
function isProductionManualDto(value) {
  return Boolean(value)
    && typeof value === 'object'
    && value.shape === PRODUCTION_MANUAL_SHAPE;
}

/**
 * Valida um objeto contra a allowlist, recursivamente, coletando violações.
 * Chave fora da allowlist = vazamento potencial (o modelo interno tem dezenas
 * de chaves técnicas) — falha por ESTRUTURA, não por heurística de conteúdo.
 */
function collectStructuralViolations(value, allowedKeys, atPath, violations) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (!allowedKeys.includes(key)) {
      violations.push({
        ruleId: 'key_not_allowed_in_production',
        path: `${atPath}.${key}`,
        match: key,
        description: `chave "${key}" não pertence ao DTO de produção`,
      });
    }
    if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (item && typeof item === 'object') {
          collectStructuralViolations(item, PRODUCTION_STEP_KEYS, `${atPath}.${key}[${index}]`, violations);
        }
      });
    } else if (child && typeof child === 'object') {
      collectStructuralViolations(child, allowedKeys, `${atPath}.${key}`, violations);
    }
  }
}

function collectTextViolations(value, atPath, violations) {
  if (typeof value === 'string') {
    for (const leak of detectProductionLeaks(value)) {
      violations.push({
        ruleId: leak.ruleId,
        path: atPath,
        match: leak.match,
        description: leak.description,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTextViolations(item, `${atPath}[${index}]`, violations));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectTextViolations(child, `${atPath}.${key}`, violations);
    }
  }
}

/**
 * FAIL-CLOSED: lança `PRODUCTION_MANUAL_LEAK` se o objeto não for exatamente um
 * `ProductionManualDTO` limpo.
 *
 * Três barreiras:
 *   1. `shape` — recusa o modelo interno (mesmo que pareça "só metadados");
 *   2. allowlist estrita de chaves (raiz e passos);
 *   3. varredura de texto com o detector canônico de vazamento.
 *
 * @param {Object} dto
 * @param {string} [context]
 * @returns {Object} o próprio dto (encadeável)
 */
function assertProductionManualDto(dto, context = 'manual PRODUCTION') {
  if (!isProductionManualDto(dto)) {
    throw new ProductionManualLeakError(
      `production_manual_leak: ${context} não é um ProductionManualDTO `
      + `(shape="${dto && dto.shape ? dto.shape : 'ausente'}")`,
      [{
        ruleId: 'not_a_production_dto',
        path: 'shape',
        match: dto && dto.shape ? String(dto.shape) : 'ausente',
        description: 'objeto interno usado como conteúdo de produção',
      }],
    );
  }

  const violations = [];
  collectStructuralViolations(dto, PRODUCTION_MANUAL_KEYS, context, violations);
  collectTextViolations(dto, context, violations);

  if (violations.length > 0) {
    const detail = violations
      .slice(0, 8)
      .map((v) => `${v.ruleId}@${v.path}("${v.match}")`)
      .join(', ');
    throw new ProductionManualLeakError(
      `production_manual_leak: ${context} contém detalhe interno — ${detail}`,
      violations,
    );
  }
  return dto;
}

/** Asserção do lado INTERNO (o modelo oposto). Não é usada para servir nada. */
function assertInternalManualMetadata(metadata, context = 'metadados internos do manual') {
  const shape = metadata && typeof metadata === 'object' ? metadata.shape : undefined;
  if (shape !== INTERNAL_MANUAL_SHAPE) {
    const error = new Error(
      `${context}: esperado ${INTERNAL_MANUAL_SHAPE}, recebido "${shape || 'ausente'}"`,
    );
    error.code = 'INTERNAL_MANUAL_SHAPE_MISMATCH';
    throw error;
  }
  return metadata;
}

/**
 * Proveniência INTERNA do manual (SUPPORT/DEVELOPMENT). Preserva a prova
 * técnica — replay, seletor, adapter — fora de qualquer superfície PRODUCTION.
 * Nunca é servida por rota nem indexada no RAG operacional.
 */
function toInternalManualProvenance(internalMetadata) {
  const meta = internalMetadata && typeof internalMetadata === 'object' ? internalMetadata : {};
  return {
    artifactType: 'manual-provenance',
    artifactVersion: '1.0.0',
    classification: 'DEVELOPMENT',
    domain: 'SYSTEM',
    shape: INTERNAL_MANUAL_SHAPE,
    manualId: meta.id || null,
    replayId: meta.replayId || null,
    journeyKey: meta.journeyKey || null,
    tenantId: meta.tenantId ? String(meta.tenantId) : null,
    redactions: Number.isFinite(Number(meta.redactions)) ? Number(meta.redactions) : 0,
    generatedAt: new Date().toISOString(),
    technicalSteps: (Array.isArray(meta.steps) ? meta.steps : []).map((step) => ({
      order: step.order,
      name: step.name,
      action: step.action || null,
      selector: step.selector || null,
      image: step.image || null,
      executedSuccessfully: step.success !== false,
    })),
  };
}

/**
 * Projeta o documento RAG OPERACIONAL do manual.
 *
 * O RAG alimenta o copiloto do operador: só recebe a representação PRODUCTION.
 * O conteúdo é revalidado aqui (não se confia que o chamador já sanitizou) e a
 * metadata indexada é construída a partir do DTO — nunca do objeto interno.
 *
 * @param {{ productionManual:Object, content:string, tenantId:string, domain?:string, classification?:string, sensitivity?:string }} params
 * @returns {{ tenantId:string, document:Object }}
 */
function toProductionRagDocument({
  productionManual,
  content,
  tenantId,
  domain = 'OPERATIONAL',
  classification = 'PRODUCTION',
  sensitivity = 'INTERNAL',
}) {
  const dto = assertProductionManualDto(productionManual, 'documento RAG PRODUCTION do manual');
  // Revalida (não confia no chamador) e usa o texto ORIGINAL — o assert é
  // fail-closed e não devolve conteúdo.
  assertProductionClean(content, 'conteúdo RAG PRODUCTION do manual');
  const text = String(content ?? '');

  return {
    tenantId: String(tenantId),
    document: {
      id: `manual:${dto.id}`,
      title: dto.title,
      content: text,
      domain,
      classification,
      sensitivity,
      metadata: {
        source: 'learning-core-manual',
        category: 'operational-manual',
        contentType: 'manual',
        sourceId: `manual:${dto.id}`,
        manualId: dto.id,
        journeyKey: dto.journeyKey,
        version: dto.version,
        dtoVersion: dto.dtoVersion,
        // Nenhum campo derivado do modelo interno (replayId/selector/trace).
      },
    },
  };
}

module.exports = {
  INTERNAL_MANUAL_SHAPE,
  PRODUCTION_MANUAL_SHAPE,
  PRODUCTION_MANUAL_DTO_VERSION,
  PRODUCTION_MANUAL_KEYS,
  PRODUCTION_STEP_KEYS,
  COMPLETED_LABEL,
  ProductionManualLeakError,
  toProductionManualStep,
  toProductionManualMetadata,
  isProductionManualDto,
  assertProductionManualDto,
  assertInternalManualMetadata,
  toInternalManualProvenance,
  toProductionRagDocument,
};
