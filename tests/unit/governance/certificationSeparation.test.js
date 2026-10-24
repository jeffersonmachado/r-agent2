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

  test('o teste unitário do validador continua no L2 e guarda a existência da suíte de certificação', () => {
    const unit = fs.readFileSync(path.join(ROOT, 'tests', 'governance', 'finalStatusProjection.test.js'), 'utf8');
    expect(unit).toContain('checkProjectionConsistency');
    expect(unit).toContain('certification');
    expect(unit).toContain('canonicalProjectionState.test.js');
  });
});
