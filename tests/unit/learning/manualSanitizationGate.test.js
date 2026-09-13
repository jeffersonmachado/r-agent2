'use strict';

/**
 * O GATE DE SANITIZAÇÃO PRECISA SER CAPAZ DE FALHAR.
 *
 * `validate:manual-sanitization` deixou de ser varredura estática de `docs/**` e
 * passou a EXECUTAR as superfícies (markdown, HTML, PDF via Chromium, resposta
 * de API, projeção do RAG). Este teste prova três coisas:
 *
 *   1. as superfícies RELATAM execução real (evidência com bytes/texto extraído,
 *      não um booleano);
 *   2. os verificadores do gate ACUSAM quando o artefato está sujo — um gate
 *      cujos checadores não falham é um gate decorativo;
 *   3. os controles de calibração (anti-falso-positivo) e os controles
 *      fail-closed (positivos) passam de verdade.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../../api/services/ragService', () => ({
  indexDocument: jest.fn(async (doc) => ({ id: doc.id, chunksCreated: 3 })),
  deindexDocument: jest.fn(async () => ({ success: true, chunksRemoved: 3 })),
}));

const {
  runAllSurfaces,
  runAntiFalsePositiveControls,
  runFailClosedControls,
  runStaticSurface,
  createSurface,
  scanText,
  scanRawTokens,
  requireContains,
} = require('../../../scripts/governance/lib/manualSanitizationSurfaces');

describe('gate de sanitização — calibração', () => {
  test('os controles anti-falso-positivo passam', () => {
    const controls = runAntiFalsePositiveControls();
    expect(controls.filter((control) => control.status !== 'PASS')).toEqual([]);
    expect(controls.map((control) => control.control)).toEqual(expect.arrayContaining([
      'componente de UI "Seletor de data"',
      'heading markdown "# Título"',
    ]));
  });

  test('os controles fail-closed passam (o pipeline recusa de verdade)', () => {
    const controls = runFailClosedControls();
    expect(controls.filter((control) => control.status !== 'PASS')).toEqual([]);
    expect(controls).toHaveLength(4);
  });
});

describe('gate de sanitização — verificadores conseguem falhar', () => {
  test('scanText acusa vazamento e preserva conteúdo legítimo', () => {
    const dirty = createSurface('TESTE');
    scanText(dirty, 'artefato', 'Fonte: replay real `abc` e alvo `#membership-button`');
    expect(dirty.leaks.length).toBeGreaterThanOrEqual(2);
    expect(dirty.leaks.map((leak) => leak.ruleId)).toContain('replay_reference');

    const clean = createSurface('TESTE_LIMPO');
    scanText(clean, 'artefato', 'Seletor de data no formato dd/MM/yyyy. # Título do manual.');
    expect(clean.leaks).toEqual([]);
  });

  test('scanRawTokens acusa tokens técnicos crus', () => {
    const surface = createSurface('TESTE');
    scanRawTokens(surface, 'artefato', 'alvo #membership-button', ['#membership-button', '##nao-existe']);
    expect(surface.leaks).toHaveLength(1);
    expect(surface.leaks[0].ruleId).toBe('raw_internal_token');
  });

  test('requireContains acusa perda de conteúdo operacional (sobre-sanitização)', () => {
    const surface = createSurface('TESTE');
    requireContains(surface, 'artefato', 'Manual sem o nome do passo', ['Seletor de data']);
    expect(surface.mustContainViolations).toHaveLength(1);
  });

  test('a superfície estática FALHA em um repositório com documento PRODUCTION sujo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-static-'));
    try {
      // PRODUCTION (prefixo canônico) e SUJO.
      fs.mkdirSync(path.join(root, 'docs', 'roteiros'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'docs', 'roteiros', 'jornada-fake.md'),
        '# Jornada\n\nFonte: replay real `abc-1` · alvo `#membership-button`\n',
      );
      // SUPPORT (proveniência técnica é legítima aqui): não pode derrubar.
      fs.writeFileSync(
        path.join(root, 'docs', 'roteiros', 'manual-fake.md'),
        'Fonte: replay real `abc-1` — roteiro de apoio\n',
      );

      const result = runStaticSurface(root);
      expect(result.surface.status).toBe('FAIL');
      expect(result.surface.leaks.length).toBeGreaterThan(0);
      expect(result.blocked.length).toBeGreaterThan(0);
      expect(result.productionFiles).toContain('docs/roteiros/jornada-fake.md');
      expect(result.productionFiles).not.toContain('docs/roteiros/manual-fake.md');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('gate de sanitização — execução real das superfícies', () => {
  test('todas as superfícies executam, com evidência e sem vazamento', async () => {
    const result = await runAllSurfaces();

    expect(result.status).toBe('PASS');
    expect(result.leaks).toEqual([]);
    expect(result.failedSurfaces).toEqual([]);
    expect(result.failedControls).toEqual([]);

    const byName = Object.fromEntries(result.surfaces.map((surface) => [surface.surface, surface]));
    expect(Object.keys(byName).sort()).toEqual([
      'MANUAL_API', 'MANUAL_DOCS', 'MANUAL_HTML', 'MANUAL_MARKDOWN', 'MANUAL_PDF', 'MANUAL_RAG',
    ]);
    for (const surface of result.surfaces) {
      expect({ surface: surface.surface, executed: surface.executed }).toEqual({
        surface: surface.surface, executed: true,
      });
      expect(surface.status).toBe('PASS');
    }

    // Evidência REAL: bytes escritos, PDF gerado e TEXTO extraído, HTTP de fato.
    expect(byName.MANUAL_MARKDOWN.evidence.bytes).toBeGreaterThan(100);
    expect(byName.MANUAL_MARKDOWN.evidence.provenanceWritten).toBe(true);
    expect(byName.MANUAL_HTML.evidence.bytes).toBeGreaterThan(200);
    expect(byName.MANUAL_PDF.evidence.file).toMatch(/^manual\.v2\.pdf$/);
    expect(byName.MANUAL_PDF.evidence.extractedChars).toBeGreaterThan(50);
    expect(byName.MANUAL_RAG.evidence.classification).toBe('PRODUCTION');
    expect(byName.MANUAL_RAG.evidence.domain).toBe('OPERATIONAL');
    expect(byName.MANUAL_API.evidence.responses).toEqual(expect.arrayContaining([201, 200, 403]));
    expect(byName.MANUAL_DOCS.evidence.productionFilesScanned).toBeGreaterThan(0);
  }, 60000);
});
