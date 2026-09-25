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

// Scan de CONTEÚDO (code-aware): sem isto o enriquecimento era só path matching — a missão exige que
// a palavra seja encontrada em símbolo/função/comentário/rota/model/teste mesmo quando o NOME do
// arquivo não a contém. Orçamento próprio para não ler 25k arquivos a cada missão.
const CONTENT_SCAN_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.sql']);
const MAX_CONTENT_FILES = Number(process.env.ENGINEERING_MISSION_SCAN_MAX_CONTENT_FILES || 6000);
const MAX_CONTENT_BYTES = Number(process.env.ENGINEERING_MISSION_SCAN_MAX_CONTENT_BYTES || 524288);

/** Trecho curto e estável da linha onde a palavra apareceu (evidência objetiva, sem chain-of-thought). */
function compactLine(line) {
  return String(line || '').trim().replace(/\s+/g, ' ').slice(0, 180);
}

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
/**
 * Classifica ONDE a palavra apareceu no conteúdo — o que a missão exige em vez de path matching.
 * Ordem importa: símbolo/rota/model valem mais como evidência de código que texto solto.
 */
const CONTENT_HIT_KINDS = Object.freeze(['symbol', 'route', 'model', 'comment', 'content']);

function classifyContentHit(line, keyword) {
  const lower = line.toLowerCase();
  const kwIndex = lower.indexOf(keyword);
  if (kwIndex === -1) return null;
  const before = line.slice(0, kwIndex);
  // Comentário: a linha é (ou começa) comentário antes da ocorrência.
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return 'comment';
  // Rota: declaração de rota HTTP com a palavra no caminho.
  if (/\b(router|app)\.(get|post|put|patch|delete)\s*\(/.test(line)) return 'route';
  // Model/tabela: definição de modelo ORM ou DDL.
  if (/sequelize\.define|DataTypes\.|CREATE TABLE|tableName\s*:/.test(line)) return 'model';
  // Símbolo: função/classe/const/variável declarada com a palavra no nome.
  const kwNormalized = keyword.replace(/[^a-z0-9]/gi, '');
  const symbolPattern = /(function|const|let|var|class|async function)\s+([A-Za-z0-9_$]+)/g;
  let match = symbolPattern.exec(line);
  while (match) {
    if (match[2].toLowerCase().replace(/[^a-z0-9]/gi, '').includes(kwNormalized)) return 'symbol';
    match = symbolPattern.exec(line);
  }
  return 'content';
}

function scanRepository(keywords) {
  const evidenceRefs = [];
  // Priorização MEDIDA: evidência por CAMINHO (o arquivo se chama assim) é mais forte que linha de
  // conteúdo, mas as duas competiam pelo mesmo orçamento e o conteúdo — varrido antes dentro de cada
  // diretório — esgotava os 40 refs, deixando o path matching de fora. Duas listas e a concatenação
  // no fim resolvem sem uma segunda varredura.
  const pathRefs = [];
  const contentRefs = [];
  const subsystemHits = new Map();
  let filesScanned = 0;
  let truncated = false;
  // Orçamento PRÓPRIO do scan de conteúdo: ler 25k arquivos seria caro demais. O teto é explícito e o
  // truncamento é reportado como fato (`contentTruncated`), nunca escondido.
  let contentFilesScanned = 0;
  let contentTruncated = false;
  const hitsByKind = {};

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
      const segments = relPath.split(path.sep);
      const subsystem = segments.slice(0, 2).join('/');

      // (1) Hit por CAMINHO — preservado, mas deixou de ser o único critério.
      // Case-insensitive dos DOIS lados: o caminho é normalizado para minúsculas e a comparação era
      // case-sensitive, então uma keyword com maiúscula (ex. 'engineeringMission', camelCase natural
      // de um nome de módulo) NUNCA casa por path. Medido por teste.
      if (keywords.some((kw) => normalizedPath.includes(String(kw).toLowerCase()))) {
        subsystemHits.set(subsystem, (subsystemHits.get(subsystem) || 0) + 1);
        if (pathRefs.length < MAX_EVIDENCE_REFS) {
          pathRefs.push({ path: relPath, kind: 'file', subsystem });
        }
        continue;
      }

      // (2) Hit por CONTEÚDO — code-aware. É o que permite encontrar a palavra quando ela não está no
      // nome do arquivo: em símbolo, função, comentário arquitetural, rota, model ou teste.
      const ext = path.extname(entry.name).toLowerCase();
      if (!CONTENT_SCAN_EXTENSIONS.has(ext)) continue;
      if (contentTruncated) continue;
      contentFilesScanned += 1;
      if (contentFilesScanned > MAX_CONTENT_FILES) {
        contentTruncated = true;
        continue;
      }
      let content;
      try {
        const stat = fs.statSync(path.join(ROOT, relPath));
        if (stat.size > MAX_CONTENT_BYTES) continue;
        content = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (const kw of keywords) {
        if (contentRefs.length >= MAX_EVIDENCE_REFS) break;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (!line.toLowerCase().includes(kw)) continue;
          const kind = classifyContentHit(line, kw) || 'content';
          hitsByKind[kind] = (hitsByKind[kind] || 0) + 1;
          subsystemHits.set(subsystem, (subsystemHits.get(subsystem) || 0) + 1);
          if (contentRefs.length < MAX_EVIDENCE_REFS) {
            contentRefs.push({
              path: relPath,
              kind,
              subsystem,
              line: i + 1,
              snippet: compactLine(line),
            });
          }
          break; // uma evidência por arquivo/palavra
        }
      }
    }
  };

  for (const root of SCAN_ROOTS) walk(root);

  // Path primeiro, conteúdo depois — a ordem é a prioridade.
  for (const ref of pathRefs) {
    if (evidenceRefs.length >= MAX_EVIDENCE_REFS) break;
    evidenceRefs.push(ref);
  }
  for (const ref of contentRefs) {
    if (evidenceRefs.length >= MAX_EVIDENCE_REFS) break;
    evidenceRefs.push(ref);
  }

  const subsystems = [...subsystemHits.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, MAX_SUBSYSTEMS)
    .map(([s]) => s);

  return { evidenceRefs, subsystems, filesScanned, truncated, contentFilesScanned, contentTruncated, hitsByKind };
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

/** * Orçamento de conhecimento (§16): um contexto de missão não pode crescer sem limite. O que é
 * cortado é REGISTRADO — truncar em silêncio produziria um contexto que parece completo e não é.
 */
const KNOWLEDGE_BUDGET_DEFAULTS = Object.freeze({
  maxItems: 6,
  maxCharsPerItem: 600,
  maxTotalChars: 3000,
  minScore: 0.35,
});

/**
 * Conhecimento de engenharia (§14–§18) via Knowledge Plane, SEMPRE no domínio SYSTEM.
 *
 * Regras que este código não negocia:
 *   - o domínio é resolvido pela identidade do ator (`resolveRetrievalScope`), nunca pelo texto da
 *     missão; se o ator não puder acessar SYSTEM, a resposta é VAZIA com degradação declarada —
 *     jamais um fallback para OPERATIONAL (isso vazaria dado de cliente para dentro da missão);
 *   - retrieval puro (`hybridRetrieve`), sem geração: o contexto alimenta o compiler, não responde
 *     ao usuário;
 *   - cada item carrega PROVENIÊNCIA (fonte, domínio, classificação, score, autoridade, hash do
 *     trecho), para que a decisão de engenharia possa ser auditada depois;
 *   - indisponibilidade degrada a confiança (`degraded`), nunca inventa conhecimento.
 *
 * @returns={Promise<{items:Array, provenance:Array, budget:Object, degraded:Array<string>, scope:Object|null}>}
 */
async function retrieveEngineeringKnowledge({
  query,
  tenantId = 'system',
  actorClassification = 'DEVELOPMENT',
  budget = {},
} = {}) {
  const limits = { ...KNOWLEDGE_BUDGET_DEFAULTS, ...budget };
  const out = {
    items: [],
    provenance: [],
    budget: { ...limits, usedItems: 0, usedChars: 0, truncated: false, dropped: 0, droppedReasons: [] },
    degraded: [],
    scope: null,
  };

  if (!query || String(query).trim().length === 0) {
    out.degraded.push('KNOWLEDGE_QUERY_EMPTY');
    return out;
  }

  let scopeResolution;
  try {
    const { resolveRetrievalScope, createResolvedScope, hybridRetrieve } = require('../../../src/core/knowledge-plane');
    scopeResolution = resolveRetrievalScope({
      actor: { id: 'engineering-mission', classification: actorClassification },
      requestedDomain: 'SYSTEM',
    });
    if (!scopeResolution || !scopeResolution.allowed || scopeResolution.scope.domain !== 'SYSTEM') {
      out.degraded.push(`KNOWLEDGE_DOMAIN_NOT_AUTHORIZED:${(scopeResolution && scopeResolution.reason) || 'unknown'}`);
      return out;
    }

    const resolvedScope = createResolvedScope({
      domain: 'SYSTEM',
      classifications: scopeResolution.scope.classifications,
      retrievalPurpose: null,
      knowledgeTypes: ['SEMANTIC'],
      policy: scopeResolution.retrievalPolicy,
      reason: scopeResolution.reason,
    });
    out.scope = { domain: resolvedScope.domain, classifications: [...resolvedScope.classifications] };

    const retrieved = await hybridRetrieve({
      query: String(query),
      tenantId,
      actor: { id: 'engineering-mission', classification: actorClassification },
      knowledgeScope: resolvedScope,
    });

    const raw = Array.isArray(retrieved.results) ? retrieved.results : [];
    // Resultado vazio é ESTADO, não silêncio: sem documentos no domínio SYSTEM a missão não recebe
    // conhecimento, e quem lê o relatório precisa saber a diferença entre "não há nada indexado" e
    // "o retrieval falhou".
    if (raw.length === 0) out.degraded.push('KNOWLEDGE_NO_RESULTS');
    for (const item of raw) {
      const score = Number(item.score ?? item.relevance ?? 0);
      if (limits.minScore && score < limits.minScore) {
        out.budget.dropped += 1;
        out.budget.droppedReasons.push('BELOW_MIN_SCORE');
        continue;
      }
      if (out.items.length >= limits.maxItems) {
        out.budget.dropped += 1;
        out.budget.droppedReasons.push('BUDGET_ITEMS_EXCEEDED');
        continue;
      }
      const text = String(item.content || item.text || item.summary || '');
      const clipped = text.length > limits.maxCharsPerItem;
      const body = clipped ? text.slice(0, limits.maxCharsPerItem) : text;
      if (out.budget.usedChars + body.length > limits.maxTotalChars) {
        out.budget.dropped += 1;
        out.budget.droppedReasons.push('BUDGET_CHARS_EXCEEDED');
        continue;
      }
      if (clipped) out.budget.truncated = true;
      out.budget.usedChars += body.length;
      out.items.push({ id: item.id || null, score, text: body, truncated: clipped });
      out.provenance.push({
        sourceId: item.id || null,
        title: item.title || item.documentTitle || null,
        domain: resolvedScope.domain,
        classification: item.classification || null,
        score,
        authority: item.authority ?? null,
        knowledgeType: item.knowledgeType || 'SEMANTIC',
        hash: sha256(body),
      });
    }
    out.budget.usedItems = out.items.length;
    out.budget.droppedReasons = [...new Set(out.budget.droppedReasons)];
  } catch (err) {
    // Knowledge Plane fora do ar degrada a confiança; não vira conhecimento inventado nem vira
    // fallback de domínio.
    out.degraded.push(`KNOWLEDGE_RETRIEVAL_UNAVAILABLE:${err.message}`);
  }
  return out;
}

/** * @returns {Promise<{facts:Object, keywords:string[], memory:Object, factsHash:string, degraded:Array<string>}>}
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

  // 4. Conhecimento de engenharia (§14–§18) via Knowledge Plane no domínio SYSTEM. Retrieval puro
  // com orçamento e proveniência: alimenta o compiler, sem geração de texto.
  const knowledge = await retrieveEngineeringKnowledge({
    query: originalMission,
    tenantId: process.env.ENGINEERING_MISSION_KNOWLEDGE_TENANT || 'system',
  });
  facts.knowledgeItems = knowledge.items.length;
  facts.knowledgeRefs = knowledge.provenance.map((p) => ({ sourceId: p.sourceId, title: p.title, hash: p.hash, score: p.score }));
  facts.knowledgeBudget = knowledge.budget;
  if (knowledge.items.length > 0) contextSources.push('ENGINEERING_RAG');
  for (const reason of knowledge.degraded) degraded.push(reason);
  if (knowledge.budget.dropped > 0) degraded.push(`KNOWLEDGE_BUDGET_TRUNCATED:${knowledge.budget.dropped}`);

  // 5. Declaração explícita de fatos que NÃO podem ser inferidos por varredura/texto.
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
  KNOWLEDGE_BUDGET_DEFAULTS,
  tokenize,
  detectFactsFromText,
  scanRepository,
  lookupEngineeringMemory,
  retrieveEngineeringKnowledge,
  collectContextFacts,
};
