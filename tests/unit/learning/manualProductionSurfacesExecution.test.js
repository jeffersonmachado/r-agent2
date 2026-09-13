'use strict';

/**
 * L5/L6 — EXECUÇÃO REAL das superfícies PRODUCTION: markdown, HTML, PDF e RAG.
 *
 * Não é teste de "grep no código": um replay real com seletor técnico, ação de
 * automação e passo não concluído é processado e as SAÍDAS (o `.md` em disco, o
 * HTML impresso, o TEXTO extraído do PDF e o documento do RAG) são varridas.
 *
 * Defeito real corrigido: o PDF era montado do `metadata.json` interno e
 * imprimia `Fonte: replay real <id>`, `alvo <code>#membership-button</code>` e
 * `falhou no replay`.
 */

const { configureRuntimeRoot } = require('../../../api/utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const mockIndexDocument = jest.fn(async (doc) => ({ id: doc.id, chunksCreated: 3 }));
jest.mock('../../../api/services/ragService', () => ({
  indexDocument: (...args) => mockIndexDocument(...args),
  deindexDocument: jest.fn(async () => ({ success: true, chunksRemoved: 3 })),
}));

const { detectProductionLeaks } = require('../../../api/services/learning/manualSanitizer');
const { toProductionManualMetadata } = require('../../../api/services/learning/manualProjection');
const { productionLeaksForIngestion, buildDocumentFromFile } = require('../../../scripts/rag-sync');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REPLAY_ID = 'surfaces-replay-1';
const TECHNICAL_SELECTOR = '#membership-button';
const TECHNICAL_SELECTOR_2 = 'textarea.support-form-textarea';

let runtimeRoot;

const REPLAY = {
  id: REPLAY_ID,
  tenantId: 'academia-a',
  journeyId: 'fitness_customer_checkin',
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
      name: 'Seletor de data',
      action: 'click',
      selector: TECHNICAL_SELECTOR,
      input: null,
      success: true,
    },
    {
      index: 3,
      name: 'Escrever nota interna',
      action: 'fill',
      selector: TECHNICAL_SELECTOR_2,
      input: 'Nota do cliente 5511999999999',
      success: false,
    },
  ],
};

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-surfaces-'));
  configureRuntimeRoot(runtimeRoot);
  const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, `${REPLAY_ID}.json`), JSON.stringify(REPLAY));
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  configureRuntimeRoot(null);
});

// `resetMocks: true` no jest.config limpa implementações entre testes.
beforeEach(() => {
  mockIndexDocument.mockReset();
  mockIndexDocument.mockResolvedValue({ id: 'manual:test', chunksCreated: 3 });
});

const manualService = require('../../../api/modules/learning-core/manualService');

async function generate() {
  return manualService.generateManualFromReplay({
    tenantId: 'academia-a',
    replayId: REPLAY_ID,
    createdBy: 'subagent-l',
  });
}

describe('MANUAL_MARKDOWN — saída real em disco', () => {
  test('o .md gerado não expõe replay/seletor/ação técnica e preserva o conteúdo', async () => {
    const internal = await generate();
    const markdown = fs.readFileSync(
      path.join(runtimeRoot, 'learning', 'manuals', internal.id, 'manual.md'),
      'utf8',
    );

    expect(detectProductionLeaks(markdown)).toEqual([]);
    expect(markdown).not.toContain(REPLAY_ID);
    expect(markdown).not.toContain(TECHNICAL_SELECTOR);
    expect(markdown).not.toContain(TECHNICAL_SELECTOR_2);
    expect(markdown).not.toMatch(/replay/i);

    // Conteúdo operacional legítimo NÃO é destruído.
    expect(markdown).toContain('Abrir Matrícula do aluno');
    expect(markdown).toContain('Seletor de data');
    expect(markdown).toContain('Situação: passo não concluído');
    // Valor anonimizado continua instrução útil (sem PII).
    expect(markdown).not.toContain('5511999999999');
  });

  test('o modelo INTERNO preserva a prova técnica (não foi destruída)', async () => {
    const internal = await generate();
    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', internal.id);
    const metadata = JSON.parse(fs.readFileSync(path.join(manualDir, 'metadata.json'), 'utf8'));
    expect(metadata.shape).toBe('INTERNAL_MANUAL_METADATA');
    expect(metadata.replayId).toBe(REPLAY_ID);
    expect(metadata.steps.some((step) => step.selector === TECHNICAL_SELECTOR)).toBe(true);
    expect(metadata.steps.some((step) => step.success === false)).toBe(true);

    const provenance = JSON.parse(fs.readFileSync(path.join(manualDir, 'provenance.json'), 'utf8'));
    expect(provenance.classification).toBe('DEVELOPMENT');
    expect(provenance.domain).toBe('SYSTEM');
    expect(provenance.replayId).toBe(REPLAY_ID);
    expect(provenance.technicalSteps.some((step) => step.selector === TECHNICAL_SELECTOR)).toBe(true);
  });

  test('o gerador FALHA FECHADO se um passo carregar detalhe interno no nome', () => {
    expect(() => manualService.__renderManualMarkdownForTest({
      title: 'Manual',
      steps: [{ order: 1, name: `Fonte: replay real \`${REPLAY_ID}\``, label: 'Clicar', completed: true }],
    })).toThrow(/production_content_leak/);
  });
});

describe('MANUAL_HTML — HTML impresso (mesmo do PDF)', () => {
  test('o HTML vem do DTO e não contém alvo técnico nem linguagem de falha', async () => {
    const internal = await generate();
    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', internal.id);
    const html = manualService.buildManualHtml(toProductionManualMetadata(internal), manualDir);

    expect(detectProductionLeaks(html)).toEqual([]);
    expect(html).not.toContain(REPLAY_ID);
    expect(html).not.toContain(TECHNICAL_SELECTOR);
    expect(html).not.toContain('alvo');
    expect(html).not.toContain('falhou no replay');
    expect(html).toContain('passo não concluído');
    expect(html).toContain('Seletor de data');
  });

  test('o HTML RECUSA o modelo interno (não há caminho "quase certo")', async () => {
    const internal = await generate();
    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', internal.id);
    expect(() => manualService.buildManualHtml(internal, manualDir))
      .toThrow(/production_manual_leak/);
  });
});

describe('MANUAL_PDF — artefato final (Chromium) e TEXTO extraído', () => {
  test('o PDF real não contém replay/seletor e mantém a orientação operacional', async () => {
    const internal = await generate();
    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', internal.id);
    // Cache LEGADO: um `manual.pdf` gerado pelo template antigo não pode ser
    // servido nem reutilizado.
    fs.writeFileSync(path.join(manualDir, 'manual.pdf'), '%PDF-1.4 legacy-dirty-cache');

    const { filePath } = await manualService.ensureManualPdf({
      tenantId: 'academia-a',
      manualId: internal.id,
    });
    expect(path.basename(filePath)).toBe('manual.v2.pdf');
    expect(filePath).not.toBe(path.join(manualDir, 'manual.pdf'));

    const buffer = fs.readFileSync(filePath);
    // eslint-disable-next-line global-require
    const pdfParse = require(path.join(REPO_ROOT, 'node_modules', 'pdf-parse'));
    const { text } = await pdfParse(buffer);

    expect(text.length).toBeGreaterThan(50);
    expect(detectProductionLeaks(text)).toEqual([]);
    expect(text).not.toContain(REPLAY_ID);
    expect(text).not.toContain(TECHNICAL_SELECTOR);
    expect(text).not.toContain('falhou no replay');
    expect(text).not.toMatch(/replay/i);
    expect(text).toContain('Seletor de data');
    expect(text).toContain('passo não concluído');
    expect(text).not.toContain('5511999999999');
    // Os bytes do arquivo também não carregam o seletor em claro.
    expect(buffer.toString('latin1')).not.toContain(TECHNICAL_SELECTOR);
  }, 60000);
});

describe('MANUAL_RAG — projeção de ingestão', () => {
  test('o documento indexado é projetado do DTO e não contém replay', async () => {
    const internal = await generate();
    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', internal.id);
    const markdown = fs.readFileSync(path.join(manualDir, 'manual.md'), 'utf8');

    expect(mockIndexDocument).toHaveBeenCalledTimes(1);
    const [document, tenantId] = mockIndexDocument.mock.calls[0];
    expect(tenantId).toBe('academia-a');
    expect(document.domain).toBe('OPERATIONAL');
    expect(document.classification).toBe('PRODUCTION');
    expect(document.content).toBe(markdown);
    expect(document.metadata.replayId).toBeUndefined();
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain(REPLAY_ID);
    expect(serialized).not.toContain(TECHNICAL_SELECTOR);
    expect(serialized).not.toMatch(/replay/i);
  });

  test('o ingestão do rag-sync BLOQUEIA documento PRODUCTION com detalhe interno', () => {
    const dirty = 'Fonte: replay real `abc` · alvo `#membership-button`';
    const blocked = productionLeaksForIngestion('docs/roteiros/jornada-x.md', dirty);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.map((item) => item.ruleId)).toContain('replay_reference');
    expect(blocked.map((item) => item.ruleId)).toContain('css_selector_token');
  });

  test('o guard não bloqueia SUPPORT (proveniência técnica é legítima lá)', () => {
    expect(productionLeaksForIngestion('docs/roteiros/manual-x.md', 'Fonte: replay real `abc`')).toEqual([]);
    expect(productionLeaksForIngestion('docs/runbooks/x.md', 'rode npm run validate:replay-governance')).toEqual([]);
  });

  test('as fontes PRODUCTION reais do repositório passam na projeção de ingestão', () => {
    const roteiros = path.join(REPO_ROOT, 'docs', 'roteiros');
    const files = fs.readdirSync(roteiros).filter((name) => name.startsWith('jornada-') && name.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const abs = path.join(roteiros, name);
      const rel = `docs/roteiros/${name}`;
      const document = buildDocumentFromFile(abs, fs.readFileSync(abs, 'utf8'));
      expect(document.document.classification).toBe('PRODUCTION');
      expect(productionLeaksForIngestion(rel, document.document.content)).toEqual([]);
    }
  });
});
