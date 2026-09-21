'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildContext, expandGlobsToFiles, ROOT } = require('../../api/services/engineeringRouter/contextBuilderService');

describe('engineeringRouter/contextBuilderService', () => {
  test('expandGlobsToFiles resolve glob real dentro do repositório', () => {
    const files = expandGlobsToFiles(['engine/engineeringRouter/constants.js']);
    expect(files).toContain('engine/engineeringRouter/constants.js');
  });

  test('expandGlobsToFiles com ** encontra múltiplos arquivos reais', () => {
    const files = expandGlobsToFiles(['engine/engineeringRouter/**']);
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((f) => f.endsWith('taskClassifier.js'))).toBe(true);
  });

  test('buildContext inclui arquivos do escopo autorizado e nunca ultrapassa o orçamento declarado', () => {
    const task = {
      id: 'task-1',
      title: 'teste',
      task_type: 'BUG_FIX',
      risk: 'LOW',
      scope: 'SMALL',
      allowed_paths: ['engine/engineeringRouter/constants.js'],
    };
    const context = buildContext(task, {});
    expect(context.includedFiles).toEqual(['engine/engineeringRouter/constants.js']);
    expect(context.budget.usedBytes).toBeLessThanOrEqual(context.budget.maxTotalBytes);
    expect(context.blockedFiles).toEqual([]);
  });

  test('buildContext prioriza arquivos de teste que falharam sobre o restante do escopo', () => {
    const task = {
      id: 'task-2', title: 't', task_type: 'BUG_FIX', risk: 'LOW', scope: 'SMALL',
      allowed_paths: ['engine/engineeringRouter/**'],
    };
    const failureBundle = { failedTests: ['engine/engineeringRouter/stateMachine.js'] };
    const context = buildContext(task, { failureBundle });
    expect(context.includedFiles[0]).toBe('engine/engineeringRouter/stateMachine.js');
  });

  test('buildContext nunca inclui .env mesmo que esteja dentro do escopo autorizado', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erv1-ctx-'));
    // Cria um .env real dentro de um subdiretório temporário FORA do repo para não afetar
    // o repositório real, e testa a política de bloqueio diretamente via applySecretPolicy
    // (o expandGlobsToFiles opera sobre o ROOT real do projeto, não sobre tmpDir).
    fs.writeFileSync(path.join(tmpDir, '.env'), 'API_KEY=super-secreto\n');
    const { applySecretPolicy } = require('../../engine/engineeringRouter/secretRedaction');
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    const { files, blocked } = applySecretPolicy([{ path: '.env', content }]);
    expect(files).toEqual([]);
    expect(blocked).toEqual([{ path: '.env', reason: 'BLOCKED_FILENAME' }]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('ROOT resolve para a raiz real do repositório (contém package.json)', () => {
    expect(fs.existsSync(path.join(ROOT, 'package.json'))).toBe(true);
  });
});
