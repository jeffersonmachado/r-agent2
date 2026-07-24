'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

let runtimeRoot;

const REPLAY_WAVE = {
  id: 'wave-manual-1',
  replayId: 'wave-manual-1',
  journeyId: 'support_ticket_flow',
  startTime: '2026-07-24T03:29:54.037Z',
  endTime: '2026-07-24T03:32:01.215Z',
  uiTrace: [
    {
      id: 'step-1', index: 1, name: 'Abrir Caixa de Entrada',
      action: 'navigate', selector: '{{urls.frontend}}/inbox', input: null,
      success: true, durationMs: 2000, screenshotAfter: 'data:image/png;base64,iVBORw0KGgo=',
    },
    {
      id: 'step-2', index: 2, name: 'Escrever nota interna',
      action: 'fill', selector: 'textarea.support-form-textarea', input: 'Nota do cliente 5511999999999',
      success: true, durationMs: 1500, screenshotAfter: 'data:image/png;base64,iVBORw0KGgo=',
    },
    {
      id: 'step-3', index: 3, name: 'Salvar nota interna',
      action: 'click', selector: 'button:has-text("Salvar nota")', input: null,
      success: true, durationMs: 900,
    },
  ],
  errors: [],
};

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-manual-test-'));
  process.env.RUNTIME_ROOT = runtimeRoot;
  const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, 'wave-manual-1.json'), JSON.stringify(REPLAY_WAVE));
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  delete process.env.RUNTIME_ROOT;
});

const {
  generateManualFromReplay,
  listManuals,
  resolveManualFile,
} = require('../../api/modules/learning-core/manualService');

describe('learning-core manualService', () => {
  test('gera manual ilustrado a partir de replay com uiTrace', async () => {
    const metadata = await generateManualFromReplay({
      tenantId: 'system',
      replayId: 'wave-manual-1',
      createdBy: 'agent-1',
    });

    expect(metadata.id).toMatch(/^manual-/);
    expect(metadata.stepCount).toBe(3);
    expect(metadata.imageCount).toBe(2);
    expect(metadata.tenantId).toBe('system');
    expect(metadata.journeyKey).toBe('support_ticket_flow');

    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', metadata.id);
    expect(fs.existsSync(path.join(manualDir, 'manual.md'))).toBe(true);
    const images = fs.readdirSync(path.join(manualDir, 'img'));
    expect(images).toHaveLength(2);
    expect(images[0]).toMatch(/^01-.*\.png$/);

    const markdown = fs.readFileSync(path.join(manualDir, 'manual.md'), 'utf8');
    expect(markdown).toContain('# Manual — jornada support_ticket_flow');
    expect(markdown).toContain('### Passo 2 — Escrever nota interna');
    expect(markdown).toContain(`](img/${images[1]})`);
    // valor sensível anonimizado pelo pipeline (telefone mascarado)
    expect(markdown).not.toContain('5511999999999');
  });

  test('usa título customizado quando fornecido', async () => {
    const metadata = await generateManualFromReplay({
      tenantId: 'system',
      replayId: 'wave-manual-1',
      title: 'Manual da Inbox',
    });
    expect(metadata.title).toBe('Manual da Inbox');
  });

  test('lista manuais apenas do tenant', async () => {
    await generateManualFromReplay({ tenantId: 'outro-tenant', replayId: 'wave-manual-1' });

    const manuals = listManuals({ tenantId: 'system' });
    expect(manuals.length).toBeGreaterThanOrEqual(2);
    expect(manuals.every((manual) => manual.tenantId === 'system')).toBe(true);
  });

  test('resolve manual.md e imagem com escopo de tenant', async () => {
    const [metadata] = listManuals({ tenantId: 'system' });

    const md = resolveManualFile({ tenantId: 'system', manualId: metadata.id, kind: 'md' });
    expect(md.contentType).toContain('text/markdown');
    expect(fs.existsSync(md.filePath)).toBe(true);

    const imgName = metadata.steps.find((step) => step.image).image.replace('img/', '');
    const img = resolveManualFile({ tenantId: 'system', manualId: metadata.id, kind: 'img', name: imgName });
    expect(img.contentType).toBe('image/png');

    expect(() => resolveManualFile({ tenantId: 'outro-tenant', manualId: metadata.id, kind: 'md' }))
      .toThrow('Manual nao encontrado');
    expect(() => resolveManualFile({ tenantId: 'system', manualId: metadata.id, kind: 'img', name: '../manual.md' }))
      .toThrow('nome de imagem invalido');
    expect(() => resolveManualFile({ tenantId: 'system', manualId: metadata.id, kind: 'img', name: 'manual.md' }))
      .toThrow('nome de imagem invalido');
  });

  test('rejeita replay sem uiTrace', async () => {
    const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
    fs.writeFileSync(path.join(replayDir, 'sem-uitrace.json'), JSON.stringify({ id: 'sem-uitrace', actions: [] }));

    await expect(generateManualFromReplay({ tenantId: 'system', replayId: 'sem-uitrace' }))
      .rejects.toThrow('nao possui rastro de UI');
    // não deixa diretório órfão para trás
    const leftovers = fs.readdirSync(path.join(runtimeRoot, 'learning', 'manuals'))
      .filter((name) => !listManuals({ tenantId: 'system' }).some((manual) => manual.id === name)
        && !listManuals({ tenantId: 'outro-tenant' }).some((manual) => manual.id === name));
    expect(leftovers).toHaveLength(0);
  });

  test('replayId inválido e inexistente geram erros tipados', async () => {
    await expect(generateManualFromReplay({ tenantId: 'system', replayId: '../etc/passwd' }))
      .rejects.toThrow('replayId invalido');
    await expect(generateManualFromReplay({ tenantId: 'system', replayId: 'nao-existe' }))
      .rejects.toThrow('Replay nao encontrado');
  });
});
