'use strict';

/**
 * Testes do dossiê de triagem (transformação PURA de dados medidos).
 *
 * O que precisa ser protegido:
 *   - agrupamento SEM correção publicada NUNCA cai no bucket automático, por mais
 *     baixa que seja a severidade: falta de remédio não é ausência de risco;
 *   - MAJOR e risco desconhecido exigem aprovação humana (Nível C), não missão
 *     automática;
 *   - a ordenação coloca primeiro o que exige decisão (KEV, sem correção,
 *     severidade), e dev-only por último;
 *   - `unmeasured` existe e nomeia o que o dossiê NÃO cobre (senão o dossiê
 *     viraria promessa);
 *   - `now` é injetado: o módulo é determinístico e não lê relógio.
 */

const {
  BUCKETS,
  bucketOf,
  buildTriageDossier,
  renderTriageMarkdown,
} = require('../../../engine/securityIntel/triageDossier');

const NOW = '2026-10-09T00:00:00.000Z';

function group(overrides = {}) {
  return {
    key: 'npm:pkg@api',
    ecosystem: 'npm',
    packageName: 'pkg',
    service: 'api',
    currentVersion: '1.0.0',
    recommendedVersion: '1.0.1',
    updateRisk: 'PATCH',
    autonomy: 'LEVEL_B_ISOLATED',
    requiresHumanApproval: false,
    advisoriesTotal: 1,
    advisoriesWithoutFix: 0,
    fullyClearable: true,
    severity: 'HIGH',
    kev: false,
    devOnly: false,
    ...overrides,
  };
}

function dossier(groups, extra = {}) {
  return buildTriageDossier({
    groups,
    policy: { blockOnSeverity: ['CRITICAL', 'HIGH'], maxWaiverDays: 90 },
    findings: { open: 248, kevOpen: 0, bySeverity: { CRITICAL: 3, HIGH: 118 }, vex: { total: 843 } },
    advisoryBase: { ageHours: 0.7, stale: false },
    gate: { decision: 'NO_GO', blocking: [1, 2], warnings: [1] },
    tenantKey: 'system',
    now: NOW,
    ...extra,
  });
}

describe('triageDossier — buckets', () => {
  it('agrupamento sem correção publicada vai para waiver/compensatório, nunca para o automático', () => {
    const notClearable = group({
      fullyClearable: false,
      advisoriesWithoutFix: 2,
      recommendedVersion: null,
      updateRisk: 'NONE',
      autonomy: 'LEVEL_C_PRODUCTION',
      requiresHumanApproval: true,
      severity: 'LOW',
    });
    expect(bucketOf(notClearable)).toBe(BUCKETS.WAIVER_OR_COMPENSATING_CONTROL);
  });

  it('MAJOR e risco desconhecido exigem aprovação humana; patch/minor isolado é nível B', () => {
    expect(bucketOf(group({ updateRisk: 'MAJOR', autonomy: 'LEVEL_C_PRODUCTION', requiresHumanApproval: true })))
      .toBe(BUCKETS.HUMAN_APPROVAL);
    expect(bucketOf(group({ updateRisk: 'UNKNOWN' }))).toBe(BUCKETS.HUMAN_APPROVAL);
    expect(bucketOf(group({ updateRisk: 'MINOR' }))).toBe(BUCKETS.AUTO_ISOLATED);
    expect(bucketOf(group({ updateRisk: 'PATCH' }))).toBe(BUCKETS.AUTO_ISOLATED);
  });

  it('motivo e comando dizem o que a decisão exige (e nada é aplicado pelo dossiê)', () => {
    const result = dossier([
      group({ packageName: 'sem-fix', fullyClearable: false, advisoriesWithoutFix: 3, recommendedVersion: null, severity: 'CRITICAL' }),
      group({ packageName: 'majorzinho', updateRisk: 'MAJOR', autonomy: 'LEVEL_C_PRODUCTION', requiresHumanApproval: true }),
      group({ packageName: 'tranquilo' }),
    ]);

    const byName = Object.fromEntries(result.groups.map((item) => [item.packageName, item]));
    expect(byName['sem-fix'].rationale).toMatch(/sem versão corrigida/);
    expect(byName['sem-fix'].command).toMatch(/waive/);
    expect(byName.majorzinho.rationale).toMatch(/MAJOR/);
    // Identidade de aprovação é DERIVADA (CLI: usuário do SO; API: token): o
    // comando sugerido não pode pedir que o operador a declare.
    expect(byName.majorzinho.command).not.toMatch(/--authorized-by/);
    expect(byName['sem-fix'].command).not.toMatch(/--approve/);
    expect(byName.majorzinho.command).toMatch(/identidade não é declarada/);
    expect(byName.tranquilo.command).toMatch(/patch-mission/);
    expect(byName.tranquilo.command).not.toMatch(/--authorized-by/);
  });

  it('usa o candidato RECOMENDADO e a chave real do achado na hora de mandar o comando', () => {
    const result = dossier([
      group({
        packageName: 'nodemailer',
        updateRisk: 'MAJOR',
        autonomy: 'LEVEL_C_PRODUCTION',
        requiresHumanApproval: true,
        recommendedVersion: '10.0.6',
        candidateKeys: ['chave-parcial-9.1.0', 'chave-limpa-10.0.6'],
        recommendedCandidateKey: 'chave-limpa-10.0.6',
      }),
      group({
        packageName: 'transformers',
        fullyClearable: false,
        advisoriesWithoutFix: 4,
        recommendedVersion: '5.10.0',
        candidateKeys: ['candidato-com-alvo-5.10.0'],
        recommendedCandidateKey: 'candidato-com-alvo-5.10.0',
        withoutFixFindingKeys: ['PYSEC-1|pypi:transformers@4.57.6#RESOLVED#rag-service'],
      }),
    ]);

    const byName = Object.fromEntries(result.groups.map((item) => [item.packageName, item]));
    // Mandar missão para o primeiro candidato da lista fixaria só parte do pacote.
    expect(byName.nodemailer.command).toContain('chave-limpa-10.0.6');
    expect(byName.nodemailer.command).not.toContain('chave-parcial-9.1.0');
    expect(byName.nodemailer.command).not.toMatch(/--authorized-by/);
    // Waiver precisa da chave REAL do achado sem correção (não de um placeholder).
    expect(byName.transformers.command).toContain('PYSEC-1|pypi:transformers@4.57.6#RESOLVED#rag-service');
    expect(byName.transformers.command).not.toContain('<findingKey>');
    const md = renderTriageMarkdown(result);
    expect(md).toContain('Candidato recomendado');
    expect(md).toContain('Achado(s) sem correção publicada');
  });
});

describe('triageDossier — ordenação, totais e honestidade', () => {
  it('ordena por KEV, bucket decisório e severidade, com dev-only por último', () => {
    const result = dossier([
      group({ packageName: 'dev', devOnly: true, updateRisk: 'PATCH' }),
      group({ packageName: 'isolado-low', severity: 'LOW' }),
      group({ packageName: 'kev-critical', severity: 'CRITICAL', kev: true }),
      group({ packageName: 'sem-fix', fullyClearable: false, advisoriesWithoutFix: 1, severity: 'MEDIUM' }),
      group({ packageName: 'major', updateRisk: 'MAJOR', autonomy: 'LEVEL_C_PRODUCTION', requiresHumanApproval: true }),
    ]);

    expect(result.groups.map((item) => item.packageName)).toEqual([
      'kev-critical', 'sem-fix', 'major', 'isolado-low', 'dev',
    ]);
  });

  it('soma dos buckets fecha com o total (nada some no caminho)', () => {
    const result = dossier([
      group({ packageName: 'a' }),
      group({ packageName: 'b', updateRisk: 'MAJOR', autonomy: 'LEVEL_C_PRODUCTION', requiresHumanApproval: true }),
      group({ packageName: 'c', fullyClearable: false, advisoriesWithoutFix: 1 }),
    ]);
    const { totals, buckets } = result;
    expect(totals.groups).toBe(3);
    expect(buckets[BUCKETS.AUTO_ISOLATED].count + buckets[BUCKETS.HUMAN_APPROVAL].count + buckets[BUCKETS.WAIVER_OR_COMPENSATING_CONTROL].count)
      .toBe(totals.groups);
    expect(totals.withoutPublishedFix).toBe(1);
  });

  it('declara o que NÃO cobre e reporta o estado medido sem recalcular o gate', () => {
    const result = dossier([group({ packageName: 'a' })]);
    expect(result.unmeasured.length).toBeGreaterThanOrEqual(3);
    expect(result.unmeasured.join(' ')).toMatch(/VEX/);
    expect(result.unmeasured.join(' ')).toMatch(/waiver/);
    expect(result.measured).toMatchObject({
      gateDecision: 'NO_GO',
      gateBlocking: 2,
      gateWarnings: 1,
      blockingFindings: 121,
      vexDiscarded: 843,
      advisoryBaseStale: false,
    });
  });

  it('exige `now` injetado e é determinístico para a mesma entrada', () => {
    expect(() => buildTriageDossier({ groups: [group()] })).toThrow(/triage_dossier_now_required/);
    const first = JSON.stringify(dossier([group({ packageName: 'x' })]));
    const second = JSON.stringify(dossier([group({ packageName: 'x' })]));
    expect(first).toBe(second);
  });

  it('markdown mostra a fila, o comando e os limites (sem prometer cobertura)', () => {
    const md = renderTriageMarkdown(dossier([
      group({ packageName: 'sem-fix', fullyClearable: false, advisoriesWithoutFix: 4, recommendedVersion: null, severity: 'CRITICAL' }),
      group({ packageName: 'tranquilo' }),
    ]));
    expect(md).toMatch(/Triagem de segurança — system/);
    expect(md).toMatch(/não decide nada/);
    expect(md).toMatch(/sem-fix/);
    expect(md).toMatch(/Limites deste dossiê/);
    expect(md).toMatch(/waive --finding/);
  });

  // A orientação ao operador NÃO pode contradizer o enforcement. `waive` é
  // SOLICITAÇÃO: o achado só é isentado após `waive-approve` por OUTRO usuário
  // (segregação de funções). A versão anterior deste comando anexava
  // "aprovador = quem executa o comando" ao pedido de isenção, o que induzia a
  // ler a solicitação como isenção vigente — medido em 2026-10-11 (introduzido
  // pelo commit 0c15e658b, do mesmo ciclo que criou o fluxo em duas etapas).
  it('o comando de isenção declara que é SOLICITAÇÃO e que a aprovação exige outro usuário', () => {
    const md = renderTriageMarkdown(dossier([
      group({ packageName: 'sem-fix', fullyClearable: false, advisoriesWithoutFix: 4, recommendedVersion: null, severity: 'CRITICAL' }),
    ]));
    expect(md).toMatch(/waive-approve --waiver <chave>/);
    expect(md).toMatch(/OUTRO usuário/);
    expect(md).toMatch(/quem solicita não pode aprovar/);
    expect(md).not.toMatch(/aprovador = quem executa o comando/);
  });

  it('mede a cobertura da fila por PACOTE (critério do gate), não por subtração de contagens', () => {
    // A primeira versão deste campo subtraía contagens de unidades diferentes
    // (achado × cópia física do gate vs. achado do inventário) e produzia uma
    // lacuna inventada. O teste fixa a medida nominal.
    const result = dossier(
      [
        group({ packageName: 'brace-expansion', blockingFindingsOpen: 4 }),
        group({ packageName: 'lodash', blockingFindingsOpen: 2 }),
      ],
      {
        gate: {
          decision: 'NO_GO',
          blocking: [
            { code: 'OPEN_VULNERABILITY', message: 'achado HIGH aberto: GHSA-1 em brace-expansion@2.1.4' },
            { code: 'OPEN_VULNERABILITY', message: 'achado HIGH aberto: GHSA-1 em brace-expansion@2.1.4' },
            { code: 'OPEN_VULNERABILITY', message: 'achado HIGH aberto: GHSA-2 em lodash@4.17.23' },
            { code: 'OPEN_VULNERABILITY', message: 'achado CRITICAL aberto: GHSA-3 em undici@9.0.0' },
          ],
          warnings: [],
        },
      },
    );

    expect(result.blockingImpact.gateBlockingItems).toBe(4);
    expect(result.blockingImpact.gateBlockingPackages).toBe(3);
    expect(result.blockingImpact.gateBlockingPackagesInQueue).toEqual(['brace-expansion', 'lodash']);
    expect(result.blockingImpact.gateBlockingPackagesOutOfQueue).toEqual(['undici']);
    expect(result.blockingImpact.unitWarning).toMatch(/Não subtraia/);
    expect(result.blockingImpact).not.toHaveProperty('notAddressedByQueue');

    const md = renderTriageMarkdown(result);
    expect(md).toContain('2 de 3');
    expect(md).toContain('FORA da fila: undici');
  });

  it('declara a concordância quando a fila e o gate chegam ao mesmo número', () => {
    // Duas medidas independentes (fila = achado de runtime por severidade bloqueante;
    // gate = lista de bloqueios da sua própria coleta). Concordarem é evidência forte;
    // divergirem é sinal de investigação — em nenhum caso se subtrai uma da outra.
    const groups = [
      group({ packageName: 'lodash', blockingFindingsOpen: 3 }),
      group({ packageName: 'postcss', blockingFindingsOpen: 2 }),
    ];
    const gate = {
      decision: 'NO_GO',
      blocking: [
        { message: 'achado HIGH aberto: GHSA-1 em lodash@4.17.23' },
        { message: 'achado HIGH aberto: GHSA-2 em lodash@4.17.23' },
        { message: 'achado HIGH aberto: GHSA-3 em lodash@4.17.23' },
        { message: 'achado HIGH aberto: GHSA-4 em postcss@8.5.6' },
        { message: 'achado HIGH aberto: GHSA-5 em postcss@8.5.6' },
      ],
      warnings: [],
    };
    const md = renderTriageMarkdown(dossier(groups, { gate }));
    expect(md).toContain('As duas medidas INDEPENDENTES concordam');
  });
});
