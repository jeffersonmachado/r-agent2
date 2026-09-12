'use strict';

/**
 * manualService.js
 *
 * Gera manuais operacionais ilustrados a partir de replays reais
 * (QA Waves / RPA). Cada manual é persistido em runtime root:
 *
 *   <runtime root>/learning/manuals/<manualId>/
 *     manual.md       — texto do manual (markdown)
 *     metadata.json   — metadados + steps (para renderização na UI)
 *     img/NN-<slug>.png — telas reais capturadas no replay
 *
 * Reutiliza o pipeline do Journey Trainer (normalizeReplay) e o anonymizer
 * do Learning Core (valores de campos nunca vazam para o manual).
 *
 * PDF: gerado sob demanda (GET .../pdf) renderizando o manual em HTML e
 * imprimindo via Chromium do Playwright (mesma dependência do RPA — nenhuma
 * dependência nova). O arquivo fica cacheado em <manualDir>/manual.pdf.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveRuntimePath } = require('../../utils/runtimePaths');
const { normalizeReplay } = require('./journeyTrainerService');
const { anonymize } = require('../../../src/core/learning/anonymizer');
const { readTenantScopedReplay } = require('./replayStorage');
// §A1–A6: fronteira PROVENIÊNCIA INTERNA × CONTEÚDO PRODUCTION. O manual do
// operador não pode expor replay, seletor, alvo técnico nem falha técnica.
const {
  sanitizeProductionText, assertProductionClean, detectProductionLeaks,
} = require('../../services/learning/manualSanitizer');
const { indexDocument } = require('../../services/ragService');
const logger = require('../../utils/logger');

const MANUAL_ID_PATTERN = /^[\w.-]{1,120}$/;

// Manual operacional é conhecimento do tenant (OPERATIONAL/PRODUCTION):
// já é sanitizado (anonymizer) e é consumido por usuários operacionais.
const MANUAL_DOMAIN = 'OPERATIONAL';
const MANUAL_CLASSIFICATION = 'PRODUCTION';
const MANUAL_SENSITIVITY = 'INTERNAL';

function ragDocumentIdForManual(manualId) {
  return `manual:${manualId}`;
}
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

/**
 * Carrega o replay exigindo prova de posse pelo tenant (fail-closed).
 * Delega ao storage tenant-scoped: replay sem `tenantId` ou de outro tenant
 * nunca é entregue, mesmo que o id seja conhecido.
 */
function loadReplay(replayId, tenantId) {
  return readTenantScopedReplay(replayId, tenantId);
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
    '> Manual operacional gerado pela plataforma (Learning Core) a partir da '
      + 'execução observada desta jornada no ambiente do cliente.',
    '',
    '## Passo a passo',
    '',
  ];

  for (const step of steps) {
    lines.push(`### Passo ${step.order} — ${step.name}`);
    lines.push('');
    // §A3: linguagem OPERACIONAL. O alvo técnico (seletor) não é instrução de
    // operador — é proveniência interna, preservada no artefato de proveniência.
    lines.push(`- Ação: **${step.label}**`);
    if (step.value !== null && step.value !== undefined && step.value !== '') {
      lines.push(`- Valor: \`${step.value}\``);
    }
    if (step.image) {
      lines.push('');
      lines.push(`![Passo ${step.order} — ${step.name}](${step.image})`);
    }
    lines.push('');
  }

  const rendered = `${lines.join('\n')}\n`;
  // §A6 backstop FAIL-CLOSED: nenhum manual PRODUCTION sai com detalhe interno,
  // mesmo que geradores futuros alterem o template.
  const { text } = sanitizeProductionText(rendered);
  assertProductionClean(text, 'manual PRODUCTION');
  return text;
}

/**
 * Proveniência INTERNA do manual — preserva auditabilidade (§A2/§A5) sem
 * contaminar o conteúdo PRODUCTION. Classificação: SUPPORT/DEVELOPMENT.
 */
function renderManualProvenance({ manualId, replayId, journeyKey, steps, stats }) {
  return {
    artifactType: 'manual-provenance',
    artifactVersion: '1.0.0',
    classification: 'DEVELOPMENT',
    domain: 'SYSTEM',
    manualId: manualId || null,
    replayId: replayId || null,
    journeyKey: journeyKey || null,
    redactions: (stats && stats.redactions) || 0,
    generatedAt: new Date().toISOString(),
    technicalSteps: (steps || []).map((step) => ({
      order: step.order,
      name: step.name,
      action: step.action || null,
      selector: step.selector || null,
      image: step.image || null,
      executedSuccessfully: step.success !== false,
    })),
  };
}

function readMetadata(manualDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(manualDir, 'metadata.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

async function generateManualFromReplay({ tenantId, replayId, title, journeyKey, createdBy }) {
  const rawReplay = loadReplay(replayId, tenantId);
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

  const ragDocumentId = ragDocumentIdForManual(manualId);
  const manualMarkdown = renderManualMarkdown({
    title: resolvedTitle, replayId, journeyKey: resolvedJourneyKey, steps, stats,
  });

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
    ragDocumentId,
    contentType: 'manual',
    version: 1,
  };

  fs.writeFileSync(path.join(manualDir, 'manual.md'), manualMarkdown);
  fs.writeFileSync(path.join(manualDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // Indexação obrigatória: um manual pronto precisa ficar consultável pelo
  // Ask AI/Tutor. O RAG é derivado — falha aqui é explícita (sem fallback
  // silencioso), mas o manual permanece no disco para reindexação.
  const indexResult = await indexDocument({
    id: ragDocumentId,
    title: resolvedTitle,
    content: manualMarkdown,
    domain: MANUAL_DOMAIN,
    classification: MANUAL_CLASSIFICATION,
    sensitivity: MANUAL_SENSITIVITY,
    metadata: {
      source: 'learning-core-manual',
      category: 'operational-manual',
      contentType: 'manual',
      sourceId: ragDocumentId,
      // §A5: a metadata indexada no RAG PRODUCTION não revela replay. A
      // rastreabilidade técnica (replayId, selector, uiTrace) fica no
      // `metadata.json` interno do manual, que não é indexado.
      manualId,
      journeyKey: resolvedJourneyKey,
      version: 1,
    },
  }, tenantId);

  metadata.ragChunksCreated = indexResult?.chunksCreated || 0;
  metadata.ragIndexedAt = new Date().toISOString();
  fs.writeFileSync(path.join(manualDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  logger.info('[learning-core] Manual gerado a partir de replay', {
    manualId, replayId, tenantId, steps: metadata.stepCount, images: metadata.imageCount,
    ragChunksCreated: metadata.ragChunksCreated,
  });

  return metadata;
}

/**
 * Remove um manual e o documento correspondente no RAG.
 *
 * Escopo por tenant: um chamador nunca remove manual de outro tenant — o id
 * é resolvido dentro do escopo e a ausência de posse devolve NOT_FOUND (não
 * vaza existência).
 */
async function deleteManual({ tenantId, manualId }) {
  if (!MANUAL_ID_PATTERN.test(String(manualId || ''))) {
    const error = new Error('manualId invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const scopedTenant = String(tenantId);
  const manualDir = path.join(manualsDir(), manualId);
  const metadata = readMetadata(manualDir);
  if (!metadata || metadata.tenantId !== scopedTenant) {
    const error = new Error(`Manual nao encontrado: ${manualId}`);
    error.code = 'NOT_FOUND';
    throw error;
  }

  let deindexed = false;
  try {
    const { deindexDocument } = require('../../services/ragService');
    await deindexDocument(metadata.ragDocumentId || ragDocumentIdForManual(manualId), scopedTenant);
    deindexed = true;
  } catch (error) {
    // Índice é derivado: se a remoção falhar, o arquivo NÃO é apagado —
    // apagar a fonte deixaria conteúdo órfão e não removível pelo id.
    logger.error('[learning-core] Falha ao remover manual do RAG', {
      manualId, tenantId: scopedTenant, error: error.message,
    });
    const failure = new Error(`Nao foi possivel remover o manual do indice: ${error.message}`);
    failure.code = 'DEINDEX_FAILED';
    throw failure;
  }

  fs.rmSync(manualDir, { recursive: true, force: true });
  logger.info('[learning-core] Manual removido', { manualId, tenantId: scopedTenant, deindexed });
  return {
    success: true,
    manualId,
    ragDocumentId: metadata.ragDocumentId || ragDocumentIdForManual(manualId),
    deindexed,
  };
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

// ── PDF (HTML → Chromium/Playwright) ────────────────────────────────────────

const PDF_TIMEOUT_MS = Number(process.env.LEARNING_MANUAL_PDF_TIMEOUT_MS || 60000);
const SYSTEM_CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

let _chromium = null;

function getChromium() {
  if (_chromium) return _chromium;
  try {
    _chromium = require('playwright').chromium;
    return _chromium;
  } catch (_) {
    return null;
  }
}

function resolveSystemChrome() {
  return SYSTEM_CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch (_) { return false; }
  }) || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Monta o HTML imprimível do manual (A4), com as telas embutidas em base64.
 * Função pura de renderização — testável sem browser.
 */
function buildManualHtml(metadata, manualDir) {
  const stepsHtml = (metadata.steps || []).map((step) => {
    let imageHtml = '';
    if (step.image) {
      const imagePath = path.join(manualDir, step.image);
      if (imagePath.startsWith(manualDir) && fs.existsSync(imagePath)) {
        const base64 = fs.readFileSync(imagePath).toString('base64');
        imageHtml = `<img src="data:image/png;base64,${base64}" alt="${escapeHtml(step.name)}" />`;
      }
    }
    return `
      <section class="step">
        <h2>Passo ${step.order} — ${escapeHtml(step.name)}</h2>
        <p class="meta">Ação: <strong>${escapeHtml(step.label)}</strong>${step.selector ? ` · alvo <code>${escapeHtml(step.selector)}</code>` : ''}${step.success === false ? ' · <span class="fail">falhou no replay</span>' : ''}</p>
        ${step.value ? `<p class="meta">Valor: <code>${escapeHtml(step.value)}</code></p>` : ''}
        ${imageHtml}
      </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(metadata.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'DejaVu Sans', Arial, sans-serif; color: #1a1a2e; font-size: 11pt; line-height: 1.45; }
  h1 { font-size: 20pt; margin: 0 0 4mm; }
  .source { color: #555; font-size: 9pt; border-left: 3px solid #888; padding-left: 8px; margin-bottom: 8mm; }
  .step { page-break-inside: avoid; margin-bottom: 7mm; }
  .step h2 { font-size: 13pt; margin: 0 0 2mm; color: #223; }
  .meta { margin: 1mm 0; font-size: 10pt; color: #333; }
  .fail { color: #c0392b; font-weight: bold; }
  code { background: #f0f0f4; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
  img { max-width: 100%; border: 1px solid #ccc; border-radius: 4px; margin-top: 2mm; }
</style>
</head>
<body>
  <h1>${escapeHtml(metadata.title)}</h1>
  <p class="source">
    Fonte: replay real <code>${escapeHtml(metadata.replayId)}</code>
    ${metadata.journeyKey ? ` · Jornada: <code>${escapeHtml(metadata.journeyKey)}</code>` : ''}
    · Gerado pela plataforma (Learning Core) em ${escapeHtml(metadata.createdAt)}.<br/>
    ${metadata.stepCount} passo(s) · ${metadata.imageCount} tela(s) · valores anonimizados (${metadata.redactions || 0} campos mascarados).
  </p>
  ${stepsHtml}
</body>
</html>`;
}

/**
 * Garante o PDF do manual (gera se não existir) e retorna o caminho.
 * Lança PDF_UNAVAILABLE quando nem Playwright nem Chrome do sistema existem.
 */
async function ensureManualPdf({ tenantId, manualId }) {
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

  const pdfPath = path.join(manualDir, 'manual.pdf');
  if (fs.existsSync(pdfPath)) return { filePath: pdfPath, metadata };

  const chromium = getChromium();
  if (!chromium) {
    const error = new Error('PDF indisponivel: Playwright nao instalado no servidor');
    error.code = 'PDF_UNAVAILABLE';
    throw error;
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (launchError) {
    const executablePath = resolveSystemChrome();
    if (!executablePath) {
      const error = new Error(`PDF indisponivel: Chromium ausente (${launchError.message})`);
      error.code = 'PDF_UNAVAILABLE';
      throw error;
    }
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(PDF_TIMEOUT_MS);
    await page.setContent(buildManualHtml(metadata, manualDir), { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    logger.info('[learning-core] PDF de manual gerado', { manualId, tenantId });
    return { filePath: pdfPath, metadata };
  } finally {
    try { await browser.close(); } catch (_) { /* noop */ }
  }
}

module.exports = {
  generateManualFromReplay,
  deleteManual,
  listManuals,
  resolveManualFile,
  buildManualHtml,
  ensureManualPdf,
  MANUAL_CLASSIFICATION,
  // Superfície de teste: permite provar que o template não vaza detalhe interno
  // sem precisar de replay real em disco (§A6).
  __renderManualMarkdownForTest: renderManualMarkdown,
  renderManualProvenance,
};
