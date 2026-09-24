'use strict';

/**
 * api/services/engineeringMission/missionContextService.js
 *
 * Coleta os FATOS de contexto que fundamentam o enriquecimento. Sem fatos, o enriquecimento vira
 * adivinhação — por isso a regra é: o modelo pode propor INTENÇÃO, nunca inventar FATO.
 *
 * Fontes usadas (todas reais e já existentes na plataforma):
 *   1. inspeção do repositório (varredura determinística e limitada de caminhos);
 *   2. histórico persistido de engenharia (EngineeringTask) + recorrência da mesma intenção
 *      (EngineeringMission) — a Engineering Memory do §29, sem criar um segundo store;
 *   3. declarações explícitas do chamador (`contextHints`), tratadas como USER_INPUT auditável.
 *
 * A varredura é limitada por orçamento (arquivos e evidências) e ordem determinística — a mesma
 * missão produz os mesmos fatos, o que mantém enriquecimento e replay reprodutíveis.
 */

const fs = require('fs');
const path = require('path');

const { sha256 } = require('../../../engine/engineeringMission/missionSpec');
const logger = require('../../utils/logger');

const ROOT = path.resolve(__dirname, '..', '..', '..');
// `tests` entrou aqui por achado real: uma missão sobre uma fixture/especificação de teste não
// encontrava NENHUMA evidência de repositório, porque a varredura simplesmente não olhava para os
// testes existentes — que são justamente o contexto que decide "isso já é coberto?".
const SCAN_ROOTS = ['api', 'engine', 'frontend/src', 'scripts', 'migrations', 'config', 'tests'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'logs', 'coverage', 'venv', '__pycache__', '.vite', 'data', 'rag-service/venv']);
// Orçamento calibrado por MEDIÇÃO (2026-09-24): 25.544 arquivos nos roots varridos. O default
// cobre a árvore inteira com margem; o teto existe para impedir varredura ilimitada se a árvore
// crescer, e nesse caso o truncamento é reportado como FATO (`scanTruncated`), nunca escondido.
const MAX_FILES_SCANNED = Number(process.env.ENGINEERING_MISSION_SCAN_MAX_FILES || 40000);
const MAX_EVIDENCE_REFS = 40;
const MAX_SUBSYSTEMS = 8;

const STOPWORDS = new Set([
  'para', 'como', 'todos', 'todas', 'deve', 'devem', 'esta', 'este', 'isso', 'aquilo', 'mais',
  'menos', 'muito', 'pouco', 'quando', 'onde', 'qual', 'quais', 'sem', 'com', 'por', 'que',
  'uma', 'dos', 'das', 'dos', 'nas', 'nos', 'pelo', 'pela', 'seja', 'ser', 'está', 'estão',
  'corrija', 'corrigir', 'deixe', 'tudo', 'verde', 'definitivamente', 'problema', 'issues',
  'please', 'with', 'that', 'this', 'from', 'have', 'will', 'should', 'must', 'into', 'then',
  // Ruído de 3 letras (o mínimo de token é 3, para não perder siglas de domínio como EVO/IVR/CRM)
  'nao', 'sao', 'seu', 'sua', 'mas', 'pra', 'pro', 'aos', 'ate', 'ja', 'os', 'as', 'de', 'da',
  'do', 'em', 'no', 'na', 'um', 'e', 'ou', 'the', 'and', 'for', 'not', 'are', 'was', 'all',
]);

const TEXT_FACT_RULES = Object.freeze([
  { fact: 'touchesSchema', re: /\b(schema|migration|migra[çc][õo]es|coluna|tabela|[íi]ndice|ddl|constraint)\b/i },
  { fact: 'touchesDatabase', re: /\b(banco|database|postgres|sql|query|persist[êe]ncia|persist\w*|reposit[óo]rio de dados)\b/i },
  { fact: 'touchesMultiTenant', re: /\b(tenant|multi-?tenant|inquilino|workspace)\b/i },
  { fact: 'touchesAuth', re: /\b(auth|autentica\w*|login|sess[ãa]o|jwt)\b/i },
  { fact: 'touchesRbac', re: /\b(rbac|role|papel|permiss[õo]es|autoriza\w*|classifica\w*)\b/i },
  { fact: 'touchesSecrets', re: /\b(secret|segredo|credencial|api[- ]?key|\.env|token|senha|password)\b/i },
  { fact: 'touchesCredentials', re: /\b(credencial|api[- ]?key|chave de api|senha|password|token)\b/i },
  { fact: 'touchesFrontend', re: /\b(frontend|tela|p[áa]gina|componente|menu|sidebar|ui|ux)\b/i },
  { fact: 'touchesDeployment', re: /\b(deploy|docker|compose|imagem|container|apache|systemd)\b/i },
  { fact: 'touchesRelease', re: /\b(release|selagem|zip|artefato|publica\w*|promo\w*)\b/i },
  { fact: 'touchesPerformanceSensitive', re: /\b(lat[êe]ncia|performance|throughput|gargalo|carga|timeout)\b/i },
  { fact: 'destructiveOperation', re: /\b(apagar|deletar|remover em massa|drop|truncate|reset\w*|limpar banco|sobrescrever|destruir)\b/i },
  { fact: 'irreversible', re: /\b(irrevers[íi]vel|sem rollback|permanente|definitivo|definitiva)\b/i },
  { fact: 'targetsProduction', re: /\b(produ[çc][ãa]o|production|prod)\b/i },
  { fact: 'incompatibleSchemaChange', re: /\b(drop|renomear|remover coluna|incompat[íi]vel|breaking change)\b/i },
]);

const HINT_KEYS = Object.freeze(TEXT_FACT_RULES.map((r) => r.fact));

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenize(text) {
  return [...new Set(
    normalize(text)
      .split(/[^a-z0-9_.\-/]+/)
      .map((w) => w.replace(/^[._\-/]+|[._\-/]+$/g, ''))
      // Mínimo de 3 caracteres (era 4): siglas de domínio — EVO, IVR, CRM, RBAC, DNS — são
      // exatamente o vocabulário que identifica o subsistema. O ruído de 3 letras é tratado por
      // STOPWORDS expandida, não pelo tamanho mínimo.
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
  )];
}

function detectFactsFromText(text) {
  const facts = {};
  for (const { fact, re } of TEXT_FACT_RULES) facts[fact] = re.test(String(text || ''));
  return facts;
}

/** Varredura determinística e limitada do repositório — sem rede, sem shell. */
function scanRepository(keywords) {
  const evidenceRefs = [];
  const subsystemHits = new Map();
  let filesScanned = 0;
  let truncated = false;

  const walk = (relDir) => {
    if (truncated) return;
    const absDir = path.join(ROOT, relDir);
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(relDir, entry.name));
        continue;
      }
      filesScanned += 1;
      if (filesScanned > MAX_FILES_SCANNED) {
        truncated = true;
        return;
      }
      const relPath = path.join(relDir, entry.name);
      const normalizedPath = normalize(relPath);
      if (!keywords.some((kw) => normalizedPath.includes(kw))) continue;
      const segments = relPath.split(path.sep);
      const subsystem = segments.slice(0, 2).join('/');
      subsystemHits.set(subsystem, (subsystemHits.get(subsystem) || 0) + 1);
      if (evidenceRefs.length < MAX_EVIDENCE_REFS) {
        evidenceRefs.push({ path: relPath, kind: 'file', subsystem });
      }
    }
  };

  for (const root of SCAN_ROOTS) walk(root);

  const subsystems = [...subsystemHits.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, MAX_SUBSYSTEMS)
    .map(([s]) => s);

  return { evidenceRefs, subsystems, filesScanned, truncated };
}

/**
 * Engineering Memory (§29) reaproveitando o histórico REAL já persistido: tasks anteriores com
 * objetivo semelhante e recorrência da MESMA intenção em missions anteriores.
 */
async function lookupEngineeringMemory({ keywords = [], originalMissionHash = null } = {}) {
  const result = { previousOccurrences: 0, relatedTasks: [], relatedGaps: [] };
  try {
    const index = require('../../db/models');
    const TaskModel = index.EngineeringTask();
    const MissionModel = index.EngineeringMission();
    const { Op } = require('sequelize');

    if (keywords.length > 0) {
      const or = [];
      for (const kw of keywords.slice(0, 6)) {
        or.push({ title: { [Op.iLike]: `%${kw}%` } });
        or.push({ objective: { [Op.iLike]: `%${kw}%` } });
      }
      const tasks = await TaskModel.findAll({ where: { [Op.or]: or }, limit: 20, order: [['updated_at', 'DESC']] });
      result.relatedTasks = tasks.map((t) => ({
        id: t.get('id'),
        title: t.get('title'),
        status: t.get('status'),
        taskType: t.get('task_type'),
      }));
      const failed = result.relatedTasks.filter((t) => ['RED', 'BLOCKED'].includes(t.status));
      result.relatedGaps = failed.map((t) => `${t.title} (${t.status})`);
    }

    if (originalMissionHash) {
      const recurring = await MissionModel.count({ where: { original_mission_hash: originalMissionHash } });
      result.previousOccurrences = Number(recurring) || 0;
    }
    if (result.previousOccurrences === 0 && result.relatedTasks.length > 0) {
      result.previousOccurrences = result.relatedTasks.length;
    }
  } catch (err) {
    // Memória é enriquecimento, não bloqueio: falha aqui degrada a confiança (fato ausente),
    // nunca inventa histórico.
    logger.warn('[missionContext] Engineering Memory indisponível', { error: err.message });
  }
  return result;
}

/**
 * @returns {Promise<{facts:Object, keywords:string[], memory:Object, factsHash:string, degraded:Array<string>}>}
 */
async function collectContextFacts({ originalMission, repository = null, branch = null, contextHints = {}, missionId = null }) {
  const degraded = [];
  const keywords = tokenize(originalMission);
  const facts = {
    repository: repository || 'r-agent2',
    branch: branch || null,
    ...detectFactsFromText(originalMission),
  };
  const contextSources = [];

  // 1. Declarações explícitas do chamador (USER_INPUT) — auditáveis e soberanas sobre heurística.
  let hintCount = 0;
  for (const key of HINT_KEYS) {
    if (contextHints && Object.prototype.hasOwnProperty.call(contextHints, key)) {
      facts[key] = contextHints[key] === true;
      hintCount += 1;
    }
  }
  if (hintCount > 0) contextSources.push('USER_INPUT');

  // 2. Inspeção do repositório (fatos de código, não de texto).
  let scan = { evidenceRefs: [], subsystems: [], filesScanned: 0, truncated: false };
  try {
    scan = scanRepository(keywords);
    contextSources.push('REPOSITORY_INSPECTION');
  } catch (err) {
    degraded.push(`REPOSITORY_SCAN_FAILED:${err.message}`);
  }

  facts.subsystems = [...new Set([...(contextHints.subsystems || []), ...scan.subsystems])];
  facts.evidenceRefs = [...scan.evidenceRefs];
  facts.filesScanned = scan.filesScanned;
  facts.scanTruncated = scan.truncated;

  // 3. Engineering Memory.
  const memory = await lookupEngineeringMemory({
    keywords,
    originalMissionHash: sha256(String(originalMission)),
  });
  if (memory.relatedTasks.length > 0 || memory.previousOccurrences > 0) contextSources.push('ENGINEERING_MEMORY');
  facts.previousOccurrences = memory.previousOccurrences;
  facts.relatedGaps = memory.relatedGaps;

  // 4. Declaração explícita de fatos que NÃO podem ser inferidos por varredura/texto.
  for (const key of ['isReleaseBlocker', 'touchesPerformanceSensitive']) {
    if (contextHints && Object.prototype.hasOwnProperty.call(contextHints, key)) facts[key] = contextHints[key] === true;
  }

  facts.contextSources = [...new Set(contextSources)];
  facts.isReleaseBlocker = facts.isReleaseBlocker === true || facts.touchesRelease === true;

  if (facts.evidenceRefs.length === 0) degraded.push('NO_CONTEXT_EVIDENCE');

  const factsHash = sha256(JSON.stringify({
    keywords,
    facts: { ...facts, evidenceRefs: facts.evidenceRefs.map((e) => e.path) },
    missionId,
  }));

  return { facts, keywords, memory, factsHash, degraded };
}

module.exports = {
  ROOT,
  SCAN_ROOTS,
  TEXT_FACT_RULES,
  HINT_KEYS,
  tokenize,
  detectFactsFromText,
  scanRepository,
  lookupEngineeringMemory,
  collectContextFacts,
};
