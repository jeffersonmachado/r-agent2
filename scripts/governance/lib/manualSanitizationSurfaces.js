'use strict';

/**
 * manualSanitizationSurfaces — executa e varre as SUPERFÍCIES PRODUCTION do
 * manual operacional.
 *
 * O gate `validate-manual-sanitization` antes só varria arquivos `docs/**` com
 * o detector de vazamento. Isso provava que os documentos em disco estavam
 * limpos, mas não provava NADA sobre o que de fato chega ao operador: o
 * markdown gerado em runtime, o HTML impresso, o PDF (Chromium), a resposta da
 * API e a projeção do RAG. Um template podia voltar a imprimir
 * `Fonte: replay real <id>` e o gate continuava verde.
 *
 * Este módulo é o "runner" das superfícies, separado do gate para poder ser
 * testado isoladamente (Jest) e reusado. Cada superfície é EXECUTADA de
 * verdade e a SAÍDA é varrida com o detector canônico.
 *
 *   MANUAL_MARKDOWN  gera um manual real e lê o `manual.md` do disco;
 *   MANUAL_HTML      renderiza o HTML A4 (o mesmo que vira PDF);
 *   MANUAL_PDF       imprime o PDF no Chromium e EXTRAI o texto do artefato;
 *   MANUAL_RAG       projeta o documento do índice OPERACIONAL;
 *   MANUAL_API       executa o handler real das rotas e varre o JSON;
 *   MANUAL_DOCS      varredura estática das fontes `docs/**` PRODUCTION +
 *                    projeção real de ingestão do `scripts/rag-sync.js`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectProductionLeaks } = require('../../../api/services/learning/manualSanitizer');
const {
  isProductionSurface, resolveDomainClassification,
} = require('../../../api/services/rag/knowledgeSurfaceClassification');
const {
  toProductionManualMetadata,
  assertProductionManualDto,
  toProductionRagDocument,
} = require('../../../api/services/learning/manualProjection');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

/** Raízes varridas na superfície estática: conhecimento que pode ser PRODUCTION. */
const SCAN_ROOTS = Object.freeze(['docs']);
const SCAN_EXTENSIONS = Object.freeze(['.md', '.html']);
const SKIP_DIRS = Object.freeze(new Set(['img', 'node_modules', '.git']));

const PRODUCTION_DTO_SHAPE = 'PRODUCTION_MANUAL_DTO';

/** Dados de prova: um replay REAL de teste com detalhe técnico de sobra. */
const REPLAY_ID = 'gate-replay-1';
const TECHNICAL_SELECTOR = 'button:has-text("Salvar matricula")';
const TECHNICAL_SELECTOR_2 = '#membership-button';
const TECHNICAL_ACTION = 'click';
const GATE_REPLAY = Object.freeze({
  id: REPLAY_ID,
  tenantId: 'system',
  journeyId: 'gate_fitness_checkin',
  uiTrace: [
    {
      index: 1,
      name: 'Abrir Matrícula do aluno',
      action: 'navigate',
      selector: '{{urls.frontend}}/fitness/students/1',
      input: null,
      success: true,
    },
    {
      index: 2,
      // Nome OPERACIONAL legítimo de componente: não pode ser removido nem
      // acionar o detector (anti-falso-positivo dentro do caminho real).
      name: 'Seletor de data',
      action: TECHNICAL_ACTION,
      selector: TECHNICAL_SELECTOR,
      input: null,
      success: true,
    },
    {
      index: 3,
      // Heading markdown como NOME de passo: também não é seletor.
      name: '# Título',
      action: 'fill',
      selector: TECHNICAL_SELECTOR_2,
      input: 'Nota interna',
      success: false,
    },
  ],
});

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, acc);
    else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) acc.push(abs);
  }
  return acc;
}

function createSurface(name) {
  return {
    surface: name,
    status: 'PASS',
    executed: false,
    evidence: {},
    leaks: [],
    mustContainViolations: [],
    error: null,
  };
}

function scanText(surface, label, text) {
  for (const leak of detectProductionLeaks(String(text ?? ''))) {
    surface.leaks.push({
      surface: surface.surface,
      artifact: label,
      ruleId: leak.ruleId,
      description: leak.description,
      match: leak.match,
      index: leak.index,
    });
  }
}

/** Token técnico cru: presente = vazamento, independentemente do detector. */
function scanRawTokens(surface, label, text, tokens) {
  const haystack = String(text ?? '');
  for (const token of tokens) {
    if (token && haystack.includes(token)) {
      surface.leaks.push({
        surface: surface.surface,
        artifact: label,
        ruleId: 'raw_internal_token',
        description: 'token técnico interno em superfície PRODUCTION',
        match: token,
      });
    }
  }
}

function requireContains(surface, label, text, needles) {
  const haystack = String(text ?? '');
  for (const needle of needles) {
    if (!haystack.includes(needle)) {
      surface.mustContainViolations.push({ artifact: label, needle });
    }
  }
}

/**
 * Executa as superfícies de RUNTIME com runtime root temporário e `ragService`
 * stubado (o índice vivo não faz parte desta prova — o gate prova a PROJEÇÃO,
 * não o serviço Python).
 *
 * @returns {Promise<Array>} superfícies executadas
 */
async function runRuntimeSurfaces() {
  // eslint-disable-next-line global-require
  const { configureRuntimeRoot } = require('../../../api/utils/runtimePaths');
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-sanitization-gate-'));
  configureRuntimeRoot(runtimeRoot);

  const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, `${REPLAY_ID}.json`), JSON.stringify(GATE_REPLAY));

  // Stub do serviço de RAG. Injetado em require.cache: o gate não depende do
  // serviço Python estar de pé, e a asserção é sobre o PAYLOAD projetado.
  const ragServicePath = require.resolve('../../../api/services/ragService');
  require.cache[ragServicePath] = {
    id: ragServicePath,
    filename: ragServicePath,
    loaded: true,
    exports: {
      indexDocument: async () => ({ chunksCreated: 1 }),
      deindexDocument: async () => ({ success: true }),
    },
  };
  const loggerPath = require.resolve('../../../api/utils/logger');
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { info() {}, warn() {}, error() {}, debug() {} },
  };

  // eslint-disable-next-line global-require
  const manualService = require('../../../api/modules/learning-core/manualService');
  // eslint-disable-next-line global-require
  const { handleLearningCoreRoutes } = require('../../../api/modules/learning-core/routes');

  const markdown = createSurface('MANUAL_MARKDOWN');
  const html = createSurface('MANUAL_HTML');
  const pdf = createSurface('MANUAL_PDF');
  const rag = createSurface('MANUAL_RAG');
  const api = createSurface('MANUAL_API');
  const surfaces = [markdown, html, pdf, rag, api];

  try {
    // ── Geração real do manual (caminho de produção completo) ─────────────
    const internalMetadata = await manualService.generateManualFromReplay({
      tenantId: 'system',
      replayId: REPLAY_ID,
      createdBy: 'gate',
    });
    markdown.executed = true;
    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', internalMetadata.id);

    const markdownText = fs.readFileSync(path.join(manualDir, 'manual.md'), 'utf8');
    scanText(markdown, 'manual.md', markdownText);
    scanRawTokens(markdown, 'manual.md', markdownText, [
      REPLAY_ID, TECHNICAL_SELECTOR, TECHNICAL_SELECTOR_2, TECHNICAL_ACTION,
    ]);
    // Conteúdo operacional tem de SOBREVIVER (prova de que não é "limpar tudo").
    requireContains(markdown, 'manual.md', markdownText, [
      'Abrir Matrícula do aluno', 'Seletor de data', '# Título', 'passo não concluído',
    ]);
    markdown.evidence = {
      bytes: Buffer.byteLength(markdownText),
      steps: internalMetadata.stepCount,
      provenanceWritten: fs.existsSync(path.join(manualDir, 'provenance.json')),
    };

    // ── HTML impresso (mesmo HTML que vira PDF) ───────────────────────────
    const productionDto = assertProductionManualDto(
      toProductionManualMetadata(internalMetadata),
      'gate: DTO do manual',
    );
    const htmlText = manualService.buildManualHtml(productionDto, manualDir);
    html.executed = true;
    scanText(html, 'manual.html', htmlText);
    scanRawTokens(html, 'manual.html', htmlText, [REPLAY_ID, TECHNICAL_SELECTOR_2]);
    requireContains(html, 'manual.html', htmlText, ['Seletor de data', 'passo não concluído']);
    html.evidence = { bytes: Buffer.byteLength(htmlText) };

    // ── PDF real (Chromium) + extração de TEXTO do artefato final ─────────
    try {
      const { filePath } = await manualService.ensureManualPdf({
        tenantId: 'system',
        manualId: internalMetadata.id,
      });
      const pdfBuffer = fs.readFileSync(filePath);
      // eslint-disable-next-line global-require
      const pdfParse = require(path.join(ROOT_DIR, 'node_modules', 'pdf-parse'));
      const extracted = await pdfParse(pdfBuffer);
      pdf.executed = true;
      scanText(pdf, 'manual.pdf', extracted.text);
      scanRawTokens(pdf, 'manual.pdf (bytes)', pdfBuffer.toString('latin1'), [
        REPLAY_ID, TECHNICAL_SELECTOR_2, 'falhou no replay',
      ]);
      requireContains(pdf, 'manual.pdf', extracted.text, ['Seletor de data', 'passo não concluído']);
      pdf.evidence = {
        file: path.basename(filePath),
        bytes: pdfBuffer.length,
        extractedChars: extracted.text.length,
      };
    } catch (error) {
      pdf.status = 'FAIL';
      pdf.error = `PDF não produzido/provado: ${error.code || ''} ${error.message}`.trim();
    }

    // ── Projeção do RAG (payload do índice OPERACIONAL) ───────────────────
    rag.executed = true;
    const ragProjection = toProductionRagDocument({
      productionManual: productionDto,
      content: markdownText,
      tenantId: 'system',
    });
    scanText(rag, 'rag.document.content', ragProjection.document.content);
    scanText(rag, 'rag.document.metadata', JSON.stringify(ragProjection.document.metadata));
    scanRawTokens(rag, 'rag.document', JSON.stringify(ragProjection.document), [
      REPLAY_ID, TECHNICAL_SELECTOR, 'selector', 'replayId', 'uiTrace',
    ]);
    rag.evidence = {
      documentId: ragProjection.document.id,
      classification: ragProjection.document.classification,
      domain: ragProjection.document.domain,
      bytes: Buffer.byteLength(ragProjection.document.content),
    };

    // ── Resposta da API (handler REAL das rotas) ──────────────────────────
    const sent = [];
    const deps = {
      requireAuth: () => ({ valid: true }),
      sendJson: (_res, code, data) => sent.push({ code, data }),
      badRequest: (_res, message) => sent.push({ code: 400, data: { error: message } }),
      hasJsonContentType: () => true,
      parseJsonBody: async () => ({ replayId: REPLAY_ID }),
    };
    const res = { writableEnded: false, writeHead() {}, end() {} };
    const developmentAgent = {
      id: 'gate-dev', username: 'gate-dev', role: 'agent', tenantId: 'system', platformRole: 'engineer',
    };
    const productionAgent = {
      id: 'gate-admin', username: 'gate-admin', role: 'admin', tenantId: 'system',
    };

    await handleLearningCoreRoutes({
      req: { agent: developmentAgent }, res, method: 'POST', pathname: '/api/learning/manuals/from-replay', deps,
    });
    await handleLearningCoreRoutes({
      req: { agent: developmentAgent }, res, method: 'GET', pathname: '/api/learning/manuals', deps,
    });
    // Principal PRODUCTION não pode gerar manual (derivação de replay é SUPPORT+).
    await handleLearningCoreRoutes({
      req: { agent: productionAgent }, res, method: 'POST', pathname: '/api/learning/manuals/from-replay', deps,
    });

    api.executed = true;
    const responses = sent.map((entry) => ({ code: entry.code, data: entry.data }));
    for (const entry of responses) {
      scanText(api, `HTTP ${entry.code}`, JSON.stringify(entry.data));
      scanRawTokens(api, `HTTP ${entry.code}`, JSON.stringify(entry.data), [
        REPLAY_ID, TECHNICAL_SELECTOR, TECHNICAL_SELECTOR_2, TECHNICAL_ACTION,
      ]);
    }
    // Estrutura: cada manual devolvido tem de ser um DTO válido (allowlist).
    for (const entry of responses) {
      const items = entry.data && Array.isArray(entry.data.manuals) ? [...entry.data.manuals] : [];
      if (entry.data && entry.data.shape === PRODUCTION_DTO_SHAPE) items.push(entry.data);
      for (const item of items) {
        try {
          assertProductionManualDto(item, `gate: HTTP ${entry.code}`);
        } catch (error) {
          api.leaks.push({
            surface: api.surface,
            artifact: `HTTP ${entry.code}`,
            ruleId: error.code || 'production_manual_leak',
            description: error.message,
            match: (error.findings || []).map((finding) => finding.path || finding.ruleId).join(','),
          });
        }
      }
    }
    if (!responses.some((entry) => entry.code === 200 || entry.code === 201)) {
      api.status = 'FAIL';
      api.error = 'nenhuma resposta de sucesso das rotas de manual';
    }
    if (!responses.some((entry) => entry.code === 403)) {
      api.status = 'FAIL';
      api.error = 'principal PRODUCTION não foi recusado na geração de manual';
    }
    api.evidence = { responses: responses.map((entry) => entry.code) };
  } catch (error) {
    for (const surface of surfaces) {
      if (!surface.executed) {
        surface.status = 'FAIL';
        surface.error = `execução interrompida: ${error.code || ''} ${error.message}`.trim();
      }
    }
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    configureRuntimeRoot(null);
  }

  return surfaces;
}

/** Controles negativos: o detector não pode acusar conteúdo operacional legítimo. */
function runAntiFalsePositiveControls() {
  const cases = [
    {
      label: 'componente de UI "Seletor de data"',
      text: 'Seletor de data no formato dd/MM/yyyy. Clique na seta para avançar ou recuar dias.',
    },
    { label: 'heading markdown "# Título"', text: '# Título\n\n## Passo a passo' },
    { label: 'prosa com "seletor de canal"', text: 'Use o seletor de canal para escolher por onde responder.' },
    { label: 'numeração "#1"', text: 'Passo #1 da jornada' },
  ];
  return cases.map((item) => {
    const leaks = detectProductionLeaks(item.text);
    return {
      control: item.label,
      status: leaks.length === 0 ? 'PASS' : 'FAIL',
      leaks: leaks.map((leak) => ({ ruleId: leak.ruleId, match: leak.match })),
    };
  });
}

/** Controles POSITIVOS: o fail-closed tem de falhar de verdade. */
function runFailClosedControls() {
  const controls = [];

  // 1. O modelo INTERNO passado como DTO de produção tem de lançar.
  const internalLike = {
    shape: 'INTERNAL_MANUAL_METADATA',
    id: 'm1',
    title: 'Manual',
    replayId: REPLAY_ID,
    steps: [{ order: 1, name: 'x', selector: TECHNICAL_SELECTOR, success: false }],
  };
  try {
    assertProductionManualDto(internalLike, 'controle interno');
    controls.push({ control: 'modelo interno recusado pelo assert de produção', status: 'FAIL', error: 'não lançou' });
  } catch (error) {
    controls.push({
      control: 'modelo interno recusado pelo assert de produção',
      status: error.code === 'PRODUCTION_MANUAL_LEAK' ? 'PASS' : 'FAIL',
      error: error.code,
    });
  }

  // 2. Chave técnica dentro do DTO tem de lançar — a barreira é ESTRUTURAL
  //    (allowlist), não textual.
  const technicalDto = toProductionManualMetadata({
    shape: 'INTERNAL_MANUAL_METADATA', id: 'm1', title: 'Manual', steps: [],
  });
  technicalDto.steps = [{
    order: 1, name: 'x', label: 'Clicar', value: null, image: null, completed: true, selector: TECHNICAL_SELECTOR,
  }];
  try {
    assertProductionManualDto(technicalDto, 'controle chave técnica');
    controls.push({ control: 'chave técnica no DTO recusada', status: 'FAIL', error: 'não lançou' });
  } catch (error) {
    controls.push({
      control: 'chave técnica no DTO recusada',
      status: error.code === 'PRODUCTION_MANUAL_LEAK' ? 'PASS' : 'FAIL',
      error: error.code,
    });
  }

  // 3. O gerador de markdown RECUSA (não mascara) um texto com vazamento.
  try {
    // eslint-disable-next-line global-require
    const manualService = require('../../../api/modules/learning-core/manualService');
    manualService.__renderManualMarkdownForTest({
      title: 'Manual',
      steps: [{
        order: 1,
        name: `Fonte: replay real \`${REPLAY_ID}\``,
        label: 'Clicar',
        value: null,
        image: null,
        completed: true,
      }],
    });
    controls.push({ control: 'markdown recusa vazamento (fail-closed)', status: 'FAIL', error: 'não lançou' });
  } catch (error) {
    controls.push({
      control: 'markdown recusa vazamento (fail-closed)',
      status: error.code === 'PRODUCTION_CONTENT_LEAK' ? 'PASS' : 'FAIL',
      error: error.code,
    });
  }

  // 4. O guard de ingestão do rag-sync BLOQUEIA conteúdo PRODUCTION sujo.
  try {
    // eslint-disable-next-line global-require
    const { productionLeaksForIngestion } = require('../../../scripts/rag-sync');
    const blocked = productionLeaksForIngestion(
      'docs/roteiros/jornada-fake.md',
      `Fonte: replay real \`${REPLAY_ID}\` com alvo \`${TECHNICAL_SELECTOR_2}\``,
    );
    controls.push({
      control: 'rag-sync bloqueia PRODUCTION sujo',
      status: blocked.length > 0 ? 'PASS' : 'FAIL',
      rules: blocked.map((item) => item.ruleId),
    });
  } catch (error) {
    controls.push({ control: 'rag-sync bloqueia PRODUCTION sujo', status: 'FAIL', error: error.message });
  }

  return controls;
}

/**
 * Varredura ESTÁTICA das fontes PRODUCTION em disco + projeção REAL de
 * ingestão do rag-sync (fail-closed: documento PRODUCTION sujo seria bloqueado).
 */
function runStaticSurface(rootDir = ROOT_DIR) {
  const surface = createSurface('MANUAL_DOCS');
  surface.executed = true;
  // eslint-disable-next-line global-require
  const { buildDocumentFromFile, productionLeaksForIngestion } = require('../../../scripts/rag-sync');

  const scanned = [];
  const productionFiles = [];
  const blocked = [];

  for (const root of SCAN_ROOTS) {
    for (const abs of walk(path.join(rootDir, root))) {
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      scanned.push(rel);
      if (!isProductionSurface(rel)) continue;
      productionFiles.push(rel);

      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch (_) {
        continue;
      }
      scanText(surface, rel, content);

      const document = buildDocumentFromFile(abs, content);
      for (const leak of productionLeaksForIngestion(rel, document.document.content)) {
        blocked.push({ rel, ruleId: leak.ruleId, match: leak.match });
      }
    }
  }

  surface.evidence = {
    filesScanned: scanned.length,
    productionFilesScanned: productionFiles.length,
    ragBlockedOnDisk: blocked.length,
  };
  if (blocked.length > 0) {
    surface.status = 'FAIL';
    surface.error = `${blocked.length} documento(s) PRODUCTION seriam BLOQUEADOS na ingestão do RAG`;
    surface.leaks.push(...blocked.map((item) => ({
      surface: surface.surface,
      artifact: item.rel,
      ruleId: item.ruleId,
      description: 'documento PRODUCTION bloqueado na projeção de ingestão',
      match: item.match,
    })));
  }

  return {
    surface,
    scanned,
    productionFiles,
    blocked,
    supportExamplesExcluded: scanned
      .filter((rel) => resolveDomainClassification(rel).classification === 'SUPPORT')
      .slice(0, 10),
  };
}

/**
 * Roda TODAS as superfícies e devolve o material bruto do relatório.
 * @returns {{ surfaces:Array, controls:Array, failClosedControls:Array, static:Object, leaks:Array, failedSurfaces:Array, failedControls:Array, status:string }}
 */
async function runAllSurfaces() {
  const runtimeSurfaces = await runRuntimeSurfaces();
  const staticResult = runStaticSurface();
  const controls = runAntiFalsePositiveControls();
  const failClosedControls = runFailClosedControls();

  const surfaces = [...runtimeSurfaces, staticResult.surface];
  const leaks = surfaces.flatMap((surface) => surface.leaks);
  const failedSurfaces = surfaces
    .filter((surface) => surface.status !== 'PASS')
    .map((surface) => surface.surface);
  const failedControls = [...controls, ...failClosedControls]
    .filter((control) => control.status !== 'PASS')
    .map((control) => control.control);

  const status = leaks.length === 0 && failedSurfaces.length === 0 && failedControls.length === 0
    ? 'PASS'
    : 'FAIL';

  return { surfaces, controls, failClosedControls, static: staticResult, leaks, failedSurfaces, failedControls, status };
}

module.exports = {
  ROOT_DIR,
  SCAN_ROOTS,
  REPLAY_ID,
  runAllSurfaces,
  runRuntimeSurfaces,
  runAntiFalsePositiveControls,
  runFailClosedControls,
  runStaticSurface,
  walk,
  createSurface,
  scanText,
  scanRawTokens,
  requireContains,
};
