'use strict';

/**
 * Learning Core — Journey Trainer Service (Fase 3).
 *
 * Pipeline: Replay real → Anonimização → Treinamento (markdown) → RAG.
 *
 *  1. Carrega um replay RPA real do runtime (runtime root/rpa/replay).
 *  2. Anonimiza TODOS os dados do replay (src/core/learning/anonymizer) —
 *     nenhum dado real de cliente/usuário entra no treinamento.
 *  3. Gera o roteiro de treinamento em markdown (passo a passo com telas,
 *     ações, valores anonimizados e checklist de validação).
 *  4. Indexa o roteiro no RAG (`indexDocument`) com id estável
 *     `training:<replayId>` — vira base de conhecimento consultável
 *     (Tutor, Academy, dúvidas de usuários novos).
 *  5. Cria uma LearningMission disponível para o tenant, ligando a jornada
 *     ao documento indexado.
 *
 * RAG indisponível → erro explícito (sem fallback). replayId é validado
 * contra path traversal (apenas basename seguro).
 */

const fs = require('fs');
const path = require('path');

const { resolveRuntimePath } = require('../../utils/runtimePaths');
const { anonymize } = require('../../../src/core/learning/anonymizer');
const { indexDocument } = require('../../services/ragService');
const getLearningMissionModel = require('../../db/models/LearningMission');
const logger = require('../../utils/logger');

const REPLAY_ID_PATTERN = /^[\w.-]{1,120}$/;

function replayDir() {
  return resolveRuntimePath('rpa', 'replay');
}

function loadReplay(replayId) {
  if (!REPLAY_ID_PATTERN.test(String(replayId || ''))) {
    const error = new Error('replayId invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const filePath = path.join(replayDir(), path.basename(`${replayId}.json`));
  if (!filePath.startsWith(replayDir()) || !fs.existsSync(filePath)) {
    const error = new Error(`Replay nao encontrado: ${replayId}`);
    error.code = 'NOT_FOUND';
    throw error;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listReplays() {
  const dir = replayDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        const replay = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        return {
          id: replay.id || name.replace(/\.json$/, ''),
          context: replay.context || null,
          startTime: replay.startTime || null,
          actions: Array.isArray(replay.actions) ? replay.actions.length : 0,
          screens: Array.isArray(replay.screens) ? replay.screens.length : 0,
          errors: Array.isArray(replay.errors) ? replay.errors.length : 0,
        };
      } catch (error) {
        logger.warn('[learning-core] Replay ilegivel ignorado na listagem', { file: name, error: error.message });
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)));
}

const ACTION_LABELS = {
  navigate: 'Navegar',
  fill: 'Preencher campo',
  click: 'Clicar',
  select: 'Selecionar opção',
  wait: 'Aguardar',
  assert: 'Validar',
};

/**
 * Normaliza o replay para o formato canonico do treinamento
 * (`actions` + `screens`). Replays de QA Waves carregam `uiTrace`
 * (name/action/selector/input/success/durationMs + screenshots base64);
 * replays legados ja trazem `actions`. Screenshots sao descartados aqui:
 * nao entram no roteiro e evitam anonimizar MBs de base64.
 */
function normalizeReplay(replay) {
  const normalized = { ...replay };
  const uiTrace = Array.isArray(replay.uiTrace) ? replay.uiTrace : [];

  if ((!Array.isArray(normalized.actions) || normalized.actions.length === 0) && uiTrace.length > 0) {
    normalized.actions = uiTrace.map((entry) => ({
      type: entry.action || entry.type || null,
      step: entry.name || null,
      selector: entry.selector || null,
      value: entry.input !== undefined ? entry.input : entry.value,
      url: entry.url || null,
      success: entry.success !== false && entry.status !== 'failed',
      error: entry.error || null,
      durationMs: entry.durationMs || null,
    }));
  }

  if (!Array.isArray(normalized.screens) || normalized.screens.length === 0) {
    const screens = [];
    for (const action of normalized.actions || []) {
      if (action.type !== 'navigate') continue;
      const target = String(action.url || action.selector || '');
      const route = target.includes('{{urls.frontend}}')
        ? target.replace('{{urls.frontend}}', '')
        : target;
      if (route && !screens.includes(route)) screens.push(route);
    }
    // Replays de wave: telas esperadas declaradas nos passos semanticos
    // (expected.page) complementam as rotas capturadas nos navigates.
    for (const step of Array.isArray(replay.journeySteps) ? replay.journeySteps : []) {
      const page = step && step.expected && typeof step.expected.page === 'string'
        ? step.expected.page
        : null;
      if (page && !screens.includes(page)) screens.push(page);
    }
    normalized.screens = screens;
  }

  if (uiTrace.length > 0) {
    normalized.uiTrace = uiTrace.map((entry) => {
      const { screenshotBefore, screenshotAfter, ...rest } = entry;
      return rest;
    });
  }

  return normalized;
}

/**
 * Exemplos sintéticos determinísticos para o roteiro. O anonymizer mascara
 * todo valor preenchido (privacidade por desenho); o treinamento, porém,
 * precisa mostrar COMO preencher. Estes exemplos são dados sintéticos fixos
 * (nunca valores do replay), classificados por sinais estruturais do campo
 * (selector/step) — mesma abordagem declarativa do classifyFormField.
 */
function syntheticExampleFor(action) {
  const signal = `${action.selector || ''} ${action.step || ''}`.toLowerCase();
  if (/datetime|data|prazo|hora|date/.test(signal)) return '2026-07-25T09:00';
  if (/t[íi]tulo|title|assunto|subject/.test(signal)) return 'Aula experimental (exemplo sintético)';
  if (/finalidade|purpose|buscar|search/.test(signal)) return 'aula experimental';
  if (/nota|notes|observ|descri|description|mensagem|textarea/.test(signal)) return 'Observações de exemplo (dado sintético)';
  if (/email|e-mail/.test(signal)) return 'cliente.exemplo@mailinator.com';
  if (/phone|telefone|celular|whatsapp/.test(signal)) return '+55 11 90000-0000';
  if (/cpf|cnpj|document/.test(signal)) return '000.000.000-00';
  if (/nome|name|cliente|customer/.test(signal)) return 'Cliente Exemplo';
  return 'texto de exemplo';
}

function describeAction(action, index) {
  const label = ACTION_LABELS[action.type] || action.type || 'Ação';
  const parts = [`${index + 1}. **${label}**`];
  if (action.step) parts.push(` — etapa \`${action.step}\``);
  const details = [];
  if (action.selector) details.push(`alvo \`${action.selector}\``);
  if (action.value !== null && action.value !== undefined) {
    const rendered = typeof action.value === 'object' ? JSON.stringify(action.value) : String(action.value);
    if (rendered) {
      const isMasked = /^\[[\w]+\]$/.test(rendered);
      if (isMasked && action.type === 'fill') {
        details.push(`valor: ${rendered} — exemplo sintético: \`${syntheticExampleFor(action)}\``);
      } else {
        details.push(`valor: \`${rendered.slice(0, 120)}\``);
      }
    }
  }
  if (action.url || (action.value && action.value.url)) details.push(`URL \`${action.url || action.value.url}\``);
  if (details.length > 0) parts.push(` (${details.join('; ')})`);
  parts.push(action.success === false ? ' ❌ falhou' : ' ✅');
  return parts.join('');
}

/**
 * Gera o roteiro de treinamento em markdown a partir do replay ANONIMIZADO.
 */
function buildTrainingDocument({ replay, stats }) {
  const actions = Array.isArray(replay.actions) ? replay.actions : [];
  const screens = Array.isArray(replay.screens) ? replay.screens : [];
  const errors = Array.isArray(replay.errors) ? replay.errors : [];
  const durationMs = replay.startTime && replay.endTime
    ? new Date(replay.endTime).getTime() - new Date(replay.startTime).getTime()
    : null;

  const lines = [
    `# Treinamento: jornada ${replay.id}`,
    '',
    `Roteiro gerado automaticamente a partir de um replay operacional real,`,
    `com todos os dados anonimizados (${stats.redactions} campos mascarados).`,
    '',
    '## Resumo',
    '',
    `- Contexto: ${replay.context || 'operacao'}`,
    `- Telas percorridas: ${screens.length}`,
    `- Ações: ${actions.length}`,
    durationMs !== null ? `- Duração de referência: ${Math.round(durationMs / 1000)}s` : null,
    `- Erros no replay original: ${errors.length}`,
    '',
    ...(screens.length > 0
      ? ['## Telas', '', ...screens.map((screen) => `- \`${screen}\``), '']
      : []),
    '## Passo a passo',
    '',
    'Valores de campos aparecem mascarados (`[valor]`, `[telefone]`, etc.) por privacidade;',
    'cada passo de preenchimento indica um **exemplo sintético** seguro para prática.',
    '',
    ...actions.map((action, index) => describeAction(action, index)),
    '',
    '## Checklist de validação',
    '',
    '- [ ] Consegui executar todos os passos sem ajuda',
    '- [ ] Entendi o objetivo de cada tela percorrida',
    '- [ ] Sei o que fazer quando um passo falha',
  ].filter((line) => line !== null);

  return lines.join('\n');
}

/**
 * Executa o pipeline replay → treinamento anonimizado → RAG → missão.
 *
 * @returns {Promise<{trainingId, ragDocumentId, missionId, steps, redactions, summary}>}
 */
async function generateTrainingFromReplay({ tenantId, replayId, journeyKey }) {
  const replay = normalizeReplay(loadReplay(replayId));

  const { value: safeReplay, stats } = anonymize(replay);
  const document = buildTrainingDocument({ replay: safeReplay, stats });

  const trainingId = `training:${replayId}`;
  const ragDocument = await indexDocument({
    id: trainingId,
    title: `Treinamento da jornada ${replayId}`,
    content: document,
    metadata: {
      source: 'learning-core',
      sourceId: trainingId,
      journeyKey: journeyKey || null,
      replayId,
      redactions: stats.redactions,
    },
  }, tenantId);

  const Mission = getLearningMissionModel();
  const summary = `Treinamento da jornada ${replayId}: ${(safeReplay.actions || []).length} passos, `
    + `${(safeReplay.screens || []).length} telas (${stats.redactions} campos anonimizados).`;
  const [mission, created] = await Mission.findOrCreate({
    where: { tenant_id: String(tenantId), replayId },
    defaults: {
      tenant_id: String(tenantId),
      agentId: null,
      journeyKey: journeyKey || null,
      title: `Treinamento: jornada ${replayId}`,
      summary,
      ragDocumentId: trainingId,
      replayId,
      status: 'available',
      metadata: { redactions: stats.redactions, byKind: stats.byKind },
    },
  });
  // Regeneração (ex.: replay refeito ou documento enriquecido) atualiza o
  // resumo da missão existente em vez de deixá-la com o snapshot antigo.
  if (!created && mission.summary !== summary) {
    await mission.update({
      summary,
      journeyKey: journeyKey || mission.journeyKey || null,
      metadata: { redactions: stats.redactions, byKind: stats.byKind },
    });
  }

  logger.info('[learning-core] Treinamento gerado a partir de replay', {
    tenantId,
    replayId,
    redactions: stats.redactions,
    missionId: mission.id,
  });

  return {
    trainingId,
    ragDocumentId: (ragDocument && ragDocument.id) || trainingId,
    missionId: mission.id,
    steps: (safeReplay.actions || []).length,
    redactions: stats.redactions,
    summary,
  };
}

module.exports = {
  generateTrainingFromReplay,
  listReplays,
  buildTrainingDocument,
  normalizeReplay,
};
