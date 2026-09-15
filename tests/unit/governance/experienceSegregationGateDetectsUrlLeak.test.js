'use strict';

/**
 * Self-proving do gate de segregação de experiência: as regras de URL/caminho
 * técnico (`file_url`, `platform_runtime_path`) DETECTAM de verdade.
 *
 * Lição que este teste materializa (registrada na memória do repo): um gate que
 * nunca falhou não é prova de nada. A extensão foi verificada uma vez à mão
 * (fixture → FAIL violations=2; sem fixture → PASS) e agora fica como regressão:
 * se alguém remover as regras ou quebrar o detector, este teste cai.
 *
 * O gate roda sobre a árvore REAL de `frontend/src/pages`, então o teste:
 *   1. cria uma superfície PRODUCTION temporária com `file://` e um caminho de
 *      runtime da plataforma;
 *   2. exige exit != 0 e os dois ids de regra no relatório;
 *   3. remove a fixture (em `finally`) e exige exit 0 na árvore limpa.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(ROOT, 'frontend', 'src', 'pages', '__GateSegregationSelftest.jsx');
const VALIDATOR = path.join(ROOT, 'scripts', 'governance', 'validate-experience-segregation.js');

const FIXTURE_SOURCE = [
  'export default function GateSegregationSelftest() {',
  '  const arquivoLocal = "file:///tmp/relatorio.pdf";',
  '  const raizRuntime = "/opt/results/ria/r-agent2/dist/candidate";',
  '  return <div data-testid="gate-segregation-selftest">{arquivoLocal}{raizLocal()}</div>;',
  '}',
  '',
  'function raizLocal() {',
  '  return "/opt/results/ria/r-agent2/dist/candidate";',
  '}',
  '',
].join('\n');

function runValidator() {
  try {
    const stdout = execFileSync(process.execPath, [VALIDATOR], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`,
    };
  }
}

describe('gate de segregação detecta URL/caminho técnico em superfície Production', () => {
  afterEach(() => {
    if (fs.existsSync(FIXTURE)) fs.rmSync(FIXTURE, { force: true });
  });

  it('falha quando uma superfície Production expõe file:// e caminho de runtime', () => {
    fs.writeFileSync(FIXTURE, FIXTURE_SOURCE, 'utf8');

    const result = runValidator();

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('status=FAIL');
    expect(result.output).toContain('file_url');
    expect(result.output).toContain('platform_runtime_path');
  }, 180000);

  it('passa na árvore limpa e não deixa resíduo da fixture', () => {
    const result = runValidator();

    expect(result.code).toBe(0);
    expect(result.output).toContain('status=PASS');
    expect(result.output).toContain('violations=0');
    expect(fs.existsSync(FIXTURE)).toBe(false);
  }, 180000);
});
