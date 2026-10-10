'use strict';

/**
 * Rastreabilidade da REMEDIAÇÃO na fila de triagem.
 *
 * Achado P1 (auditoria 2026-10-10): a fila sugeria o comando de correção sem
 * mostrar o estado do que já havia sido submetido — o operador não conseguia
 * distinguir "ainda não submeti" de "submeti e a missão falhou". E nada declarava
 * que resolver o achado exige RE-SCAN: quem resolve é o inventário atual deixar de
 * casar o advisory, nunca a simples mudança de versão declarada.
 */

const fs = require('fs');
const path = require('path');

const { summarizeRemediation, buildTriageDossier } = require('../../../engine/securityIntel/triageDossier');

function group(overrides = {}) {
  return {
    key: 'npm:pkg@api',
    packageName: 'pkg',
    service: 'api',
    ecosystem: 'npm',
    currentVersion: '1.0.0',
    recommendedVersion: '1.0.1',
    updateRisk: 'PATCH',
    autonomy: 'LEVEL_B_ISOLATED',
    severity: 'HIGH',
    advisoriesTotal: 1,
    fullyClearable: true,
    candidateKeys: ['c1'],
    recommendedCandidateKey: 'c1',
    ...overrides,
  };
}

describe('summarizeRemediation — estado da correção já submetida', () => {
  test('sem missão submetida devolve null (nada a reportar)', () => {
    expect(summarizeRemediation(undefined)).toBeNull();
    expect(summarizeRemediation([])).toBeNull();
  });

  test('agrega por status e preserva a ÚLTIMA submissão', () => {
    const summary = summarizeRemediation([
      { missionId: 'm1', status: 'BLOCKED', candidateKey: 'c1' },
      { missionId: 'm2', status: 'GREEN', candidateKey: 'c2' },
      { missionId: 'm3', status: 'GREEN', candidateKey: 'c3' },
    ]);

    expect(summary).toMatchObject({
      missionsSubmitted: 3,
      byStatus: { BLOCKED: 1, GREEN: 2 },
      latest: { missionId: 'm3', status: 'GREEN' },
      resolvedRequiresRescan: true,
    });
  });

  test('status ausente vira UNKNOWN (não se inventa estado)', () => {
    const summary = summarizeRemediation([{ missionId: 'm1' }]);
    expect(summary.byStatus).toEqual({ UNKNOWN: 1 });
  });

  test('GREEN de missão NÃO é tratado como achado resolvido (re-scan é a autoridade)', () => {
    const summary = summarizeRemediation([{ missionId: 'm1', status: 'GREEN' }]);
    expect(summary.resolvedRequiresRescan).toBe(true);
    expect(summary).not.toHaveProperty('resolved');
  });
});

describe('dossiê — o grupo carrega a remediação', () => {
  test('grupo com remediações expõe o resumo; sem remediações expõe null', () => {
    const dossier = buildTriageDossier({
      groups: [
        group({ remediations: [{ missionId: 'm1', status: 'BLOCKED' }] }),
        group({ key: 'npm:outro@api', packageName: 'outro', remediations: [] }),
      ],
      findings: { open: 1, kevOpen: 0, bySeverity: {} },
      advisoryBase: { ageHours: 1, stale: false },
      policy: {},
      now: '2026-10-10T00:00:00.000Z',
    });

    const byName = Object.fromEntries(dossier.groups.map((item) => [item.packageName, item]));
    expect(byName.pkg.remediation).toMatchObject({
      missionsSubmitted: 1,
      latest: { missionId: 'm1', status: 'BLOCKED' },
    });
    expect(byName.pkg.remediation.byStatus).toEqual({ BLOCKED: 1 });
    expect(byName.pkg.remediation.resolvedRequiresRescan).toBe(true);
    expect(byName.outro.remediation).toBeNull();
  });
});

describe('não-vacuidade: o serviço coleta o estado das missões', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../api/services/securityIntel/triageService.js'),
    'utf8',
  );

  test('consulta as missões submetidas e as entrega ao dossiê', () => {
    expect(source).toMatch(/getEngineeringMission\(\)\.findAll/);
    expect(source).toMatch(/missionStatusById/);
    expect(source).toMatch(/remediations: entry\.remediations/);
  });

  test('a resolução de um achado é do RE-SCAN, não da missão', () => {
    const scanSource = fs.readFileSync(
      path.join(__dirname, '../../../api/services/securityIntel/vulnerabilityScanService.js'),
      'utf8',
    );
    // O achado só é resolvido quando deixa de casar no inventário atual.
    expect(scanSource).toMatch(/no_longer_matched_by_current_inventory/);
  });
});
