/**
 * v2TimeoutGateDependency.test.js — o SELO V2 depende da ARQUITETURA DE TIMEOUTS.
 *
 * DEFEITO REAL corrigido em 2026-09-28: `scripts/governance/validate-engineering-router-v2.js` não
 * tinha UMA ÚNICA menção a timeout. O selo podia ser GO com lease/heartbeat/fence/deadline/
 * progresso NO_GO — a auditoria da missão encontrou exatamente esse estado
 * (`TIMEOUT_GATE_IN_V2_SEAL = NO_GO`).
 *
 * Este teste prova a dependência nos DOIS sentidos e é ADVERSARIAL: ele força o relatório filho a
 * cada estado ruim (NO_GO, inventário incompleto, ausente, vencido) e exige que o selo REPROVE o
 * item. Nenhum estado ruim pode virar PASS, e nenhuma ausência de evidência pode virar aprovação.
 *
 * O relatório real é salvo e restaurado (byte a byte) em `afterAll`; o próprio teste verifica a
 * restauração.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const VALIDATOR = path.join(ROOT, 'scripts', 'governance', 'validate-engineering-router-v2.js');
const ITEM_ID = 'V2_TIMEOUT_ARCHITECTURE_GREEN';

/**
 * ISOLAMENTO OBRIGATÓRIO (defeito real corrigido em 2026-09-28): a versão anterior escrevia e
 * apagava `reports/TIMEOUT_ARCHITECTURE_REPORT.json` — a evidência REAL — e rodava o validador, que
 * PUBLICA o relatório canônico do selo. Resultado medido: depois de `npm run test:unit`,
 * `reports/engineering-router-v2-seal-report.json` ficava gravado com o resultado do ÚLTIMO caso de
 * teste (`NO_GO`, "evidência vencida") — um teste unitário republicava veredito de governança a
 * partir de fixtures mutadas. Agora o validador opera dentro de um diretório TEMPORÁRIO
 * (`ENGINEERING_V2_REPORTS_DIR`) com cópias dos relatórios reais: nada em `reports/` é tocado.
 */
const SOURCE_REPORTS = [
  'reports/anti-greenwashing-report.json',
  'reports/mission-crash-recovery-report.json',
  'reports/TIMEOUT_ARCHITECTURE_REPORT.json',
  'reports/real-task-recovery-report.json',
  'reports/engineering-router-v2-requirements-matrix.json',
  'reports/engineering-router-v2-required-tests-report.json',
  'reports/rag-index-health-report.json',
  'ENGINEERING_ROUTER_V2_STATUS_REPORT.json',
];

let tmpDir;
let timeoutReportPath;
/** Conteúdo original do relatório de timeout (cópia temporária) — base de cada caso. */
let original;

/** Roda o validador como SUBPROCESSO (mesmo caminho da pipeline), apontando-o ao tmpDir. */
function runV2Validator() {
  const result = spawnSync(process.execPath, [VALIDATOR, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ENGINEERING_V2_REPORTS_DIR: tmpDir },
  });
  if (result.error) throw result.error;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`saída do validador V2 não é JSON: ${error.message}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return { report, exitCode: result.status, item: (report.items || []).find((i) => i.id === ITEM_ID) };
}

function readReport() {
  return JSON.parse(fs.readFileSync(timeoutReportPath, 'utf8'));
}

function baselineReport() {
  return JSON.parse(original.toString('utf8'));
}

function mutate(mutator) {
  const report = baselineReport();
  mutator(report);
  writeReport(report);
  return report;
}

function writeReport(report) {
  fs.writeFileSync(timeoutReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

describe('V2 Seal — dependência obrigatória de TIMEOUT_ARCHITECTURE', () => {
  jest.setTimeout(120000);

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-seal-timeout-'));
    for (const rel of SOURCE_REPORTS) {
      const src = path.join(ROOT, rel);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(tmpDir, path.basename(rel)));
    }
    timeoutReportPath = path.join(tmpDir, 'TIMEOUT_ARCHITECTURE_REPORT.json');
    original = fs.readFileSync(timeoutReportPath);
  });

  afterAll(() => {
    // Nada em `reports/` foi tocado; a única limpeza é o diretório temporário do próprio teste.
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('o teste NÃO escreve nem publica nada em reports/ (isolamento verificado)', () => {
    const realTimeout = path.join(ROOT, 'reports', 'TIMEOUT_ARCHITECTURE_REPORT.json');
    const realSeal = path.join(ROOT, 'reports', 'engineering-router-v2-seal-report.json');
    expect(path.dirname(timeoutReportPath)).toBe(tmpDir);
    expect(timeoutReportPath).not.toBe(realTimeout);
    expect(fs.existsSync(realTimeout)).toBe(true);
    const sealBefore = fs.existsSync(realSeal) ? fs.statSync(realSeal).mtimeMs : null;
    mutate((report) => { report.verdicts = { ...report.verdicts, TIMEOUT_ARCHITECTURE: 'NO_GO' }; });
    runV2Validator();
    const sealAfter = fs.existsSync(realSeal) ? fs.statSync(realSeal).mtimeMs : null;
    expect(sealAfter).toBe(sealBefore);
  });

  test('o item de timeout EXISTE no selo (não é eixo decorativo em outro script)', () => {
    const { item } = runV2Validator();
    expect(item).toBeDefined();
    expect(item.id).toBe(ITEM_ID);
  });

  test('relatório GREEN ⇒ item PASS (a dependência não reprova evidência boa)', () => {
    mutate((report) => {
      report.verdicts = { ...report.verdicts, TIMEOUT_ARCHITECTURE: 'GREEN', TIMEOUT_INVENTORY: 'COMPLETE' };
    });
    const { item } = runV2Validator();
    expect(item.status).toBe('PASS');
  });

  test('filho NO_GO ⇒ item FAIL e o selo registra a falha (child NO_GO → parent NO_GO)', () => {
    mutate((report) => {
      report.verdicts = { ...report.verdicts, TIMEOUT_ARCHITECTURE: 'NO_GO' };
    });

    const { report, item } = runV2Validator();
    expect(item.status).toBe('FAIL');
    expect(item.detail).toMatch(/TIMEOUT_ARCHITECTURE=NO_GO/);
    expect(report.status).toBe('NO_GO');
    expect((report.failures || []).map((f) => f.id)).toContain(ITEM_ID);
  });

  test('inventário incompleto ⇒ FAIL mesmo com arquitetura GREEN (inventário semântico é requisito)', () => {
    mutate((report) => {
      report.verdicts = { ...report.verdicts, TIMEOUT_ARCHITECTURE: 'GREEN', TIMEOUT_INVENTORY: 'INCOMPLETE' };
    });

    const { item } = runV2Validator();
    expect(item.status).toBe('FAIL');
    expect(item.detail).toMatch(/TIMEOUT_INVENTORY=INCOMPLETE/);
  });

  test('evidência AUSENTE ⇒ FAIL, nunca pendência silenciosa (fail-closed)', () => {
    fs.unlinkSync(timeoutReportPath);
    const { item } = runV2Validator();
    // Restaura no diretório TEMPORÁRIO: o relatório real nunca foi tocado.
    fs.writeFileSync(timeoutReportPath, original);
    expect(item.status).toBe('FAIL');
    expect(item.detail).toMatch(/ausente/);
  });

  test('evidência VENCIDA (>7 dias) ⇒ FAIL (prova velha não governa release)', () => {
    mutate((report) => {
      report.verdicts = { ...report.verdicts, TIMEOUT_ARCHITECTURE: 'GREEN', TIMEOUT_INVENTORY: 'COMPLETE' };
      report.generatedAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    });

    const { item } = runV2Validator();
    expect(item.status).toBe('FAIL');
    expect(item.detail).toMatch(/vencida/);
  });
});
