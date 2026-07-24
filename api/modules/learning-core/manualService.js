'use strict';

/**
 * manualService.js
 *
 * Gera manuais operacionais ilustrados a partir de replays reais
 * (QA Waves / RPA). Cada manual é persistido em runtime root:
 *
 *   <RUNTIME_ROOT>/learning/manuals/<manualId>/
 *     manual.md       — texto do manual (markdown)
 *     metadata.json   — metadados + steps (para renderização na UI)
 *     img/NN-<slug>.png — telas reais capturadas no replay
 *
 * Reutiliza o pipeline do Journey Trainer (normalizeReplay) e o anonymizer
 * do Learning Core (valores de campos nunca vazam para o manual).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveRuntimePath } = require('../../utils/runtimePaths');
const { normalizeReplay } = require('./journeyTrainerService');
const { anonymize } = require('../../../src/core/learning/anonymizer');
const logger = require('../../utils/logger');

const REPLAY_ID_PATTERN = /^[\w.-]{1,120}$/;
const MANUAL_ID_PATTERN = /^[\w.-]{1,120}$/;
const IMG_NAME_PATTERN = /^[\w.-]{1,120}\.png$/;

const ACTION_LABELS = {
  navigate: 'Navegar',
  fill: 'Preencher campo',
  click: 'Clicar',
  select: 'Selecionar opção',
  wait: 'Aguardar',
  assert: 'Validar',
};

function manualsDir() {
  return resolveRuntimePath('learning', 'manuals');
}

function loadReplay(replayId) {
  if (!REPLAY_ID_PATTERN.test(String(replayId || ''))) {
    const error = new Error('replayId invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const filePath = path.join(resolveRuntimePath('rpa', 'replay'), path.basename(`${replayId}.json`));
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Replay nao encontrado: ${replayId}`);
    error.code = 'NOT_FOUND';
    throw error;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(text, fallback) {
  const slug = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function decodeScreenshot(data) {
  if (!data || typeof data !== 'string') return null;
  const base64 = data.replace(/^data:image\/\w+;base64,/, '');
  try {
    const buffer = Buffer.from(base64, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch (_) {
    return null;
  }
}

/**
 * Extrai os passos do manual a partir do uiTrace do replay (fonte das
 * screenshots reais). Replays sem uiTrace não geram manual ilustrado.
 */
function buildManualSteps(replay, manualDir) {
  const uiTrace = Array.isArray(replay.uiTrace) ? replay.uiTrace : [];
  const steps = [];

  uiTrace.forEach((entry, index) => {
    const order = index + 1;
    const name = entry.step || entry.name || `Passo ${order}`;
    const action = entry.action || entry.type || null;
    const step = {
      order,
      action,
      label: ACTION_LABELS[action] || 'Ação',
      name,
      selector: entry.selector || null,
      value: entry.input !== undefined ? entry.input : entry.value,
      success: entry.success !== false && entry.status !== 'failed',
      image: null,
    };

    const screenshot = decodeScreenshot(entry.screenshotAfter);
    if (screenshot) {
      const fileName = `${String(order).padStart(2, '0')}-${slugify(name, 'passo')}.png`;
      fs.writeFileSync(path.join(manualDir, 'img', fileName), screenshot);
      step.image = `img/${fileName}`;
    }
    steps.push(step);
  });

  return steps;
}

function renderManualMarkdown({ title, replayId, journeyKey, steps, stats }) {
  const lines = [
    `# ${title}`,
    '',
    `> Fonte: replay real \`${replayId}\` · Jornada: \`${journeyKey || 'n/a'}\` · Gerado pela plataforma (Learning Core) em ${new Date().toISOString()}.`,
    `> Valores de campos anonimizados (${stats?.redactions || 0} campos mascarados).`,
    '',
    '## Passo a passo',
    '',
  ];

  for (const step of steps) {
    lines.push(`### Passo ${step.order} — ${step.name}`);
    lines.push('');
    lines.push(`- Ação: **${step.label}**${step.selector ? ` (alvo \`${step.selector}\`)` : ''}`);
    if (step.value !== null && step.value !== undefined && step.value !== '') {
      lines.push(`- Valor: \`${step.value}\``);
    }
    lines.push(`- Resultado: ${step.success ? 'sucesso ✅' : 'falha ❌'}`);
    if (step.image) {
      lines.push('');
      lines.push(`![Passo ${step.order} — ${step.name}](${step.image})`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function readMetadata(manualDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(manualDir, 'metadata.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

async function generateManualFromReplay({ tenantId, replayId, title, journeyKey, createdBy }) {
  const rawReplay = loadReplay(replayId);
  // Anonimiza o replay bruto (o normalizeReplay descarta as screenshots do
  // uiTrace, e o manual precisa delas). O campo `name` do uiTrace é chave
  // sensível para o anonymizer (nomes de pessoas), então ele é remapeado
  // para `step` antes da anonimização — mesmo padrão do normalizeReplay.
  const preShaped = {
    ...rawReplay,
    uiTrace: (Array.isArray(rawReplay.uiTrace) ? rawReplay.uiTrace : []).map((entry) => {
      const { name, ...rest } = entry;
      return { ...rest, step: name || null };
    }),
  };
  const { value: replay, stats } = anonymize(preShaped);

  const manualId = `manual-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const manualDir = path.join(manualsDir(), manualId);
  fs.mkdirSync(path.join(manualDir, 'img'), { recursive: true });

  const steps = buildManualSteps(replay, manualDir);
  if (steps.length === 0) {
    fs.rmSync(manualDir, { recursive: true, force: true });
    const error = new Error(`Replay ${replayId} nao possui rastro de UI (uiTrace) para gerar manual ilustrado`);
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const resolvedJourneyKey = journeyKey || replay.journeyId || replay.journeyKey || null;
  const resolvedTitle = String(title || '').trim()
    || `Manual — jornada ${resolvedJourneyKey || replayId}`;

  const metadata = {
    id: manualId,
    title: resolvedTitle,
    tenantId: String(tenantId),
    replayId,
    journeyKey: resolvedJourneyKey,
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
    steps: steps.map((step) => ({ ...step, value: step.value ?? null })),
    stepCount: steps.length,
    imageCount: steps.filter((step) => step.image).length,
    redactions: stats?.redactions || 0,
  };

  fs.writeFileSync(
    path.join(manualDir, 'manual.md'),
    renderManualMarkdown({ title: resolvedTitle, replayId, journeyKey: resolvedJourneyKey, steps, stats })
  );
  fs.writeFileSync(path.join(manualDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  logger.info('[learning-core] Manual gerado a partir de replay', {
    manualId, replayId, tenantId, steps: metadata.stepCount, images: metadata.imageCount,
  });

  return metadata;
}

function listManuals({ tenantId }) {
  const dir = manualsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => readMetadata(path.join(dir, name)))
    .filter((meta) => meta && meta.tenantId === String(tenantId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Resolve um arquivo do manual (manual.md ou img/<nome>.png) com guarda
 * de path traversal e escopo por tenant. Retorna { filePath, contentType }.
 */
function resolveManualFile({ tenantId, manualId, kind, name }) {
  if (!MANUAL_ID_PATTERN.test(String(manualId || ''))) {
    const error = new Error('manualId invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const manualDir = path.join(manualsDir(), manualId);
  const metadata = readMetadata(manualDir);
  if (!metadata || metadata.tenantId !== String(tenantId)) {
    const error = new Error(`Manual nao encontrado: ${manualId}`);
    error.code = 'NOT_FOUND';
    throw error;
  }

  let filePath;
  let contentType;
  if (kind === 'md') {
    filePath = path.join(manualDir, 'manual.md');
    contentType = 'text/markdown; charset=utf-8';
  } else if (kind === 'img') {
    if (!IMG_NAME_PATTERN.test(String(name || ''))) {
      const error = new Error('nome de imagem invalido');
      error.code = 'BAD_REQUEST';
      throw error;
    }
    filePath = path.join(manualDir, 'img', path.basename(name));
    contentType = 'image/png';
  } else {
    const error = new Error('tipo de arquivo invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  if (!filePath.startsWith(manualDir) || !fs.existsSync(filePath)) {
    const error = new Error('arquivo do manual nao encontrado');
    error.code = 'NOT_FOUND';
    throw error;
  }
  return { filePath, contentType, metadata };
}

module.exports = {
  generateManualFromReplay,
  listManuals,
  resolveManualFile,
};
