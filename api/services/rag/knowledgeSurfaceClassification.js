'use strict';

/**
 * knowledgeSurfaceClassification — FONTE ÚNICA da taxonomia de superfície de
 * conhecimento (domínio × classificação) usada para decidir o que entra no RAG
 * e o que é conteúdo PRODUCTION.
 *
 * Extraído de `scripts/rag-sync.js` (§A9 da missão corretiva: não duplicar
 * taxonomia) para que o gate de sanitização de manuais e o sincronizador do RAG
 * apliquem EXATAMENTE a mesma regra. Se as duas listas divergissem, um documento
 * poderia ser PRODUCTION para o gate e DEVELOPMENT para o índice — ou pior, o
 * inverso: entrar em PRODUCTION sem passar pela sanitização.
 *
 * Princípio (fail-closed): o que não for explicitamente operacional cai em
 * SYSTEM/DEVELOPMENT. O domínio é decidido pelo CAMINHO canônico, nunca pelo
 * conteúdo, coerente com `domain_policy.py`.
 *
 *   OPERATIONAL/PRODUCTION → produto/cliente (visível a qualquer usuário)
 *   OPERATIONAL/SUPPORT    → operação de atendimento/suporte
 *   SYSTEM/SUPPORT         → runbooks/diagnóstico (auditor)
 *   SYSTEM/DEVELOPMENT     → arquitetura/QA/engenharia (super_admin)
 */

const SYSTEM_DEV_DIRS = Object.freeze([
  'AI_MEMORY/',
  'config/',
  'contracts/',
  'docs/governance/',
  'docs/architecture/',
  'docs/qa/',
  'docs/cognitive-core/',
  'docs/rag/',
  'docs/rpa-reliability-handbook/',
  'docs/release/',
  'docs/diagrams/',
  'docs/history/',
  'docs/platform/',
  'docs/capabilities/',
  'docs/contracts/',
]);

const SYSTEM_SUPPORT_DIRS = Object.freeze([
  'docs/runbooks/',
  'docs/operations/',
]);

/** Prefixos de conteúdo OPERACIONAL visível a usuário final (PRODUCTION). */
const OPERATIONAL_PROD_PREFIXES = Object.freeze([
  'docs/manual/',
  'docs/cliente/',
  'docs/roteiros/jornada-',
]);

/** Prefixos operacionais de apoio (SUPPORT). */
const OPERATIONAL_SUPPORT_PREFIXES = Object.freeze([
  'docs/roteiros/manual-',
  'docs/roteiros/treinamento-',
  'docs/roteiros/README',
]);

/**
 * Documentos de ENGENHARIA que estavam classificados como PRODUCTION por padrão
 * de nome amplo. Conteúdo verificado (2026-09-12): env vars de evidência
 * (`PHYSICAL_QUEUE_EVIDENCE_PATH`), caminhos `qa/*-evidence.json`, execução de
 * `scripts/test-*-smoke.js` e dependência de `tools/system/lib/runtime-paths.js`.
 * Isso é DEVELOPMENT — e a classificação errada era justamente o que fazia
 * conteúdo interno entrar na superfície PRODUCTION do RAG.
 */
const SYSTEM_DEV_FILE_PATTERNS = Object.freeze([
  /^docs\/DOUTRINA_OPERACIONAL/,
  /^docs\/DOCUMENTACAO_OPERACIONAL_INDICE/,
  /^docs\/00_DOCUMENTACAO_INDEX/,
]);

/**
 * Conteúdo OPERACIONAL de apoio sobre recurso restrito (SUPPORT).
 * `COMO_USAR_REPLAY` documenta Replay, que na segregação de experiência é
 * SUPPORT ("Replay autorizado") — não é procedimento de operador PRODUCTION.
 */
const OPERATIONAL_SUPPORT_FILE_PATTERNS = Object.freeze([
  /^docs\/COMO_USAR_REPLAY/,
  /^docs\/COMO_USAR_RPA/,
]);

/** Documentos soltos na raiz de docs/ que descrevem produto/uso (não técnico). */
const OPERATIONAL_PROD_FILE_PATTERNS = Object.freeze([
  /^docs\/COMO_USAR(?!_REPLAY)/,
  /^docs\/COMO_ACESSAR_FUNCIONALIDADES/,
  /^docs\/GUIA_ACESSO_ATENDIMENTO/,
  /^docs\/GUIA_MANUTENCAO_FILAS/,
  /^docs\/FILAS_FISICAS/,
  /^docs\/FLUXO_APOS_LOGIN/,
  /^docs\/CASOS_DE_USO/,
]);

/**
 * Classifica um caminho RELATIVO à raiz do repositório.
 * @param {string} rel
 * @returns {{domain:string, classification:string}}
 */
function resolveDomainClassification(rel) {
  const path = String(rel || '');
  if (SYSTEM_DEV_DIRS.some((p) => path.startsWith(p))) {
    return { domain: 'SYSTEM', classification: 'DEVELOPMENT' };
  }
  if (SYSTEM_SUPPORT_DIRS.some((p) => path.startsWith(p))) {
    return { domain: 'SYSTEM', classification: 'SUPPORT' };
  }
  if (OPERATIONAL_PROD_PREFIXES.some((p) => path.startsWith(p))) {
    return { domain: 'OPERATIONAL', classification: 'PRODUCTION' };
  }
  if (OPERATIONAL_SUPPORT_PREFIXES.some((p) => path.startsWith(p))) {
    return { domain: 'OPERATIONAL', classification: 'SUPPORT' };
  }
  // Padrões de ARQUIVO: engenharia antes de produto, para que um nome amplo de
  // PRODUCTION não capture documento técnico.
  if (SYSTEM_DEV_FILE_PATTERNS.some((p) => p.test(path))) {
    return { domain: 'SYSTEM', classification: 'DEVELOPMENT' };
  }
  if (OPERATIONAL_SUPPORT_FILE_PATTERNS.some((p) => p.test(path))) {
    return { domain: 'OPERATIONAL', classification: 'SUPPORT' };
  }
  if (OPERATIONAL_PROD_FILE_PATTERNS.some((p) => p.test(path))) {
    return { domain: 'OPERATIONAL', classification: 'PRODUCTION' };
  }
  return { domain: 'SYSTEM', classification: 'DEVELOPMENT' };
}

/** `true` quando o caminho é superfície PRODUCTION (conteúdo visível a cliente). */
function isProductionSurface(rel) {
  return resolveDomainClassification(rel).classification === 'PRODUCTION';
}

module.exports = {
  SYSTEM_DEV_DIRS,
  SYSTEM_SUPPORT_DIRS,
  SYSTEM_DEV_FILE_PATTERNS,
  OPERATIONAL_PROD_PREFIXES,
  OPERATIONAL_SUPPORT_PREFIXES,
  OPERATIONAL_PROD_FILE_PATTERNS,
  OPERATIONAL_SUPPORT_FILE_PATTERNS,
  resolveDomainClassification,
  isProductionSurface,
};
