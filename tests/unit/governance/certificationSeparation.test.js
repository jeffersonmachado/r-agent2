'use strict';

/**
 * FASE 3 / MISSÃO D — SEPARAÇÃO FORMAL ENTRE DESENVOLVIMENTO (L2) E CERTIFICAÇÃO.
 *
 * O teste `tests/governance/finalStatusProjection.test.js` valida o validador com FIXTURES — isso é
 * L2 legítimo. Uma asserção dele olhava o ESTADO REAL do repositório e dependia de
 * `governance/rap-master-scorecard.json`: artefato gitignored, produzido em RUN GOVERNADO. Num
 * checkout limpo ele não existe e o L2 ficava vermelho por dependência de CERTIFICAÇÃO (medido:
 * `--scenario l2-system` → FAIL com `canonical_unreadable:missing`).
 *
 * A responsabilidade foi separada SEM remover o controle:
 *   - L2 (`test:system`): não depende de evidência governada;
 *   - certificação (`test:certification`, exigido em `PASSOS.R`): exige o estado canônico e
 *     reprova com `BLOCKED_BY_GOVERNED_EVIDENCE` quando a prova não existe — nunca PASS por omissão.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const CERT = path.join(ROOT, 'tests', 'certification', 'canonicalProjectionState.test.js');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('P3-D — separação L2 × certificação', () => {
  test('a suíte de certificação existe e declara o bloqueio por evidência governada', () => {
    expect(fs.existsSync(CERT)).toBe(true);
    const fonte = fs.readFileSync(CERT, 'utf8');
    expect(fonte).toContain('BLOCKED_BY_GOVERNED_EVIDENCE');
    expect(fonte).toContain('checkProjectionConsistency(ROOT)');
    expect(fonte).toContain('rap-master-scorecard.json');
  });

  test('`test:system` (L2) NÃO inclui a suíte de certificação', () => {
    expect(pkg.scripts['test:system']).not.toMatch(/tests\/certification/);
    expect(pkg.scripts['test:certification']).toBe('jest tests/certification');
  });

  test('o controle continua EXIGIDO na fase de certificação (PASSOS.R)', () => {
    const { PASSOS } = require('../../../scripts/ci/dev-branch-gate');
    const ids = (PASSOS.R || []).map((p) => p.id);
    expect(ids).toContain('L1-projecao-estado-canonico');
    const passo = PASSOS.R.find((p) => p.id === 'L1-projecao-estado-canonico');
    expect(passo.comando).toContain('test:certification');
    // E não vaza para as fases de desenvolvimento.
    const idsD = (PASSOS.D || []).map((p) => p.id);
    expect(idsD).not.toContain('L1-projecao-estado-canonico');
    expect((PASSOS.C || []).map((p) => p.comando).join(' ')).not.toMatch(/test:certification/);
  });

  test('a suíte de certificação REPROVA de fato quando o scorecard governado não existe (comportamento)', () => {
    // Achado 6 da revisão: guards por substring não provam nada. Aqui a suíte é EXECUTADA num
    // clone descartável sem `governance/rap-master-scorecard.json` e o exit code é conferido.
    const os = require('os');
    const { execFileSync, spawnSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-cert-'));
    try {
      // Copia `governance/` e `scripts/governance/` (código) e REMOVE todos os `.json` do destino:
      // é exatamente a condição de checkout limpo — sem `governance/rap-master-scorecard.json`.
      const { execFileSync: exec } = require('child_process');
      for (const dir of ['governance', 'scripts']) {
        exec('cp', ['-a', path.join(ROOT, dir), tmp]);
      }
      fs.mkdirSync(path.join(tmp, 'tests', 'certification'), { recursive: true });
      fs.copyFileSync(CERT, path.join(tmp, 'tests', 'certification', 'canonicalProjectionState.test.js'));
      fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'));
      const removerJson = (dir) => {
        for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entrada.name);
          if (entrada.isDirectory()) removerJson(abs);
          else if (entrada.name.endsWith('.json')) fs.rmSync(abs, { force: true });
        }
      };
      removerJson(path.join(tmp, 'governance'));
      // `governance/rap-master-scorecard.json` AUSENTE de propósito (checkout limpo).
      // Configuração INLINE (o `jest.config.cjs` do repo depende de helpers locais que não são
      // copiados): o alvo aqui é provar o exit code da suíte, não reproduzir a config completa.
      const config = JSON.stringify({ rootDir: tmp, testEnvironment: 'node', testMatch: ['**/*.test.js'] });
      const r = spawnSync('npx', ['jest', '--config', config], {
        cwd: tmp, encoding: 'utf8', timeout: 120000,
        env: { ...process.env, GIT_CONFIG_COUNT: '0', NODE_ENV: 'test' },
      });
      const saida = `${r.stdout}${r.stderr}`;
      expect(saida).toContain('BLOCKED_BY_GOVERNED_EVIDENCE');
      expect(r.status).not.toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('o teste unitário do validador continua no L2 e guarda a existência da suíte de certificação', () => {
    const unit = fs.readFileSync(path.join(ROOT, 'tests', 'governance', 'finalStatusProjection.test.js'), 'utf8');
    expect(unit).toContain('checkProjectionConsistency');
    expect(unit).toContain('certification');
    expect(unit).toContain('canonicalProjectionState.test.js');
  });
});
