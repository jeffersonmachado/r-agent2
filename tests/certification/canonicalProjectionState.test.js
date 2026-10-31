'use strict';

/**
 * CERTIFICAÇÃO — ESTADO CANÔNICO DAS PROJEÇÕES (Fase 3, missão D).
 *
 * POR QUE ESTE ARQUIVO NÃO ESTÁ EM `tests/governance` (L2)
 * -------------------------------------------------------
 * O teste original (`finalStatusProjection.test.js`) é um teste UNITÁRIO do validador e usa
 * FIXTURES temporárias — passa em qualquer checkout. Uma única asserção dele olhava o ESTADO REAL
 * do repositório, e essa depende de `governance/rap-master-scorecard.json`: artefato **gitignored**,
 * produzido dentro de um **run governado** (runId/sourceFingerprint do selo). Num checkout limpo ele
 * não existe (`canonical_unreadable:missing`) e o L2 ficava vermelho por dependência de CERTIFICAÇÃO.
 *
 * MEDIDO em 2026-10-24: regenerar o scorecard localmente (`governance/revalidate-master-scorecard.js`)
 * produz divergência (`canonical_divergence: readiness.sourceFingerprint != scorecard.sourceFingerprint`,
 * `stale_run_id`) — é estado FABRICADO, proibido pela missão.
 *
 * Portanto a responsabilidade foi SEPARADA, sem remover o controle:
 *   - L2 (`npm run test:system`): validação de desenvolvimento, sem evidência governada;
 *   - certificação (`npm run test:certification`, `PASSOS.R` do dev-branch-gate): exige o estado
 *     canônico selado. Ausência de evidência governada = BLOCKED, nunca PASS.
 */

const fs = require('fs');
const path = require('path');

const { checkProjectionConsistency } = require('../../scripts/governance/validate-final-status-projection');

const ROOT = path.join(__dirname, '..', '..');
const SCORECARD = path.join(ROOT, 'governance', 'rap-master-scorecard.json');

const evidenciaGovernadaPresente = fs.existsSync(SCORECARD) && fs.statSync(SCORECARD).size > 0;

describe('certificação — projeções canônicas do estado real do repositório', () => {
  test('a dependência de evidência governada é DECLARADA (não presumida)', () => {
    // O teste não "pula": ele reprova se a evidência governada não existir, e o motivo é nomeado.
    // Em ambiente só de desenvolvimento o gate de certificação fica BLOCKED por este caminho.
    if (!evidenciaGovernadaPresente) {
      throw new Error(
        'BLOCKED_BY_GOVERNED_EVIDENCE: governance/rap-master-scorecard.json ausente — '
        + 'é artefato gitignored produzido por run governado; regenerar localmente produziria '
        + 'estado fabricado (medido: canonical_divergence + stale_run_id).',
      );
    }
    expect(evidenciaGovernadaPresente).toBe(true);
  });

  test('estado real do repositório está consistente com a canônica', () => {
    if (!evidenciaGovernadaPresente) {
      throw new Error('BLOCKED_BY_GOVERNED_EVIDENCE: governance/rap-master-scorecard.json ausente');
    }
    const result = checkProjectionConsistency(ROOT);
    expect(result.issues).toEqual([]);
    expect(result.status).toBe('PASS');
  });
});
