import { describe, it, expect } from 'vitest';
import {
  HUMAN_DECISION_BUCKETS,
  decisionFindingsFromTriage,
  buildWaiverOptions,
} from './waiverOptions.js';

/**
 * Regressão do defeito medido em 2026-10-08 na tela de engenharia: o seletor de
 * achado para isenção oferecia `findings.slice(0, 50)` de 1091 achados abertos,
 * deixando 31 dos 35 achados de decisão humana inalcançáveis pela tela.
 */

const finding = (key, extra = {}) => ({
  finding_key: key,
  package_name: key.split('|')[1]?.split('@')[0] || 'pacote',
  installed_version: '1.0.0',
  advisory_id: key.split('|')[0],
  severity: 'HIGH',
  ...extra,
});

const group = (packageName, bucket, findingKeys, extra = {}) => ({
  key: `${packageName}@1.0.0->2.0.0`,
  packageName,
  severity: 'HIGH',
  bucket,
  findingKeys,
  withoutFixFindingKeys: [],
  ...extra,
});

describe('decisionFindingsFromTriage', () => {
  it('separa só os buckets que exigem decisão humana', () => {
    const triage = {
      groups: [
        group('isolado', 'AUTO_ISOLATED', ['GHSA-1|npm:isolado@1.0.0']),
        group('aprovar', 'HUMAN_APPROVAL', ['GHSA-2|npm:aprovar@1.0.0']),
        group('isentar', 'WAIVER_OR_COMPENSATING_CONTROL', ['GHSA-3|npm:isentar@1.0.0']),
      ],
    };
    const decision = decisionFindingsFromTriage(triage);
    expect(decision.map((d) => d.findingKey)).toEqual([
      'GHSA-2|npm:aprovar@1.0.0',
      'GHSA-3|npm:isentar@1.0.0',
    ]);
    expect(HUMAN_DECISION_BUCKETS).toContain('WAIVER_OR_COMPENSATING_CONTROL');
  });

  it('deduplica mantendo a severidade mais grave e marca ausência de correção', () => {
    const key = 'GHSA-9|npm:multi@1.0.0';
    const triage = {
      groups: [
        group('multi', 'HUMAN_APPROVAL', [key], { severity: 'LOW' }),
        group('multi', 'WAIVER_OR_COMPENSATING_CONTROL', [key], {
          severity: 'CRITICAL',
          withoutFixFindingKeys: [key],
        }),
      ],
    };
    const decision = decisionFindingsFromTriage(triage);
    expect(decision).toHaveLength(1);
    expect(decision[0].severity).toBe('CRITICAL');
    expect(decision[0].withoutFix).toBe(true);
  });

  it('não inventa decisão quando a fila não veio', () => {
    expect(decisionFindingsFromTriage(null)).toEqual([]);
    expect(decisionFindingsFromTriage({})).toEqual([]);
  });
});

describe('buildWaiverOptions — o corte da lista não pode esconder decisão', () => {
  const decisionKey = 'GHSA-KEY|npm:critico@9.9.9';
  const triage = {
    groups: [group('critico', 'HUMAN_APPROVAL', [decisionKey], { severity: 'CRITICAL' })],
  };

  it('oferece o achado de decisão mesmo fora da lista carregada (limite da API)', () => {
    // 120 achados carregados, nenhum deles é o de decisão (a API cortou).
    const items = Array.from({ length: 120 }, (_, i) => finding(`GHSA-A${i}|npm:outro${i}@1.0.0`));
    const options = buildWaiverOptions({ findings: { items, total: 1091 }, triage });
    expect(options.decision.map((d) => d.value)).toEqual([decisionKey]);
    expect(options.capped).toBe(true);
    expect(options.totalOpen).toBe(1091);
  });

  it('REGRESSÃO: decisão na posição 90 de 120 ainda é oferecida', () => {
    const items = Array.from({ length: 120 }, (_, i) => finding(`GHSA-A${i}|npm:outro${i}@1.0.0`));
    items[90] = finding(decisionKey, { package_name: 'critico', advisory_id: 'GHSA-KEY' });
    const options = buildWaiverOptions({ findings: { items, total: 120 }, triage });
    // O corte de 50 (defeito) não pode alcançar a decisão: ela vem do grupo da fila.
    expect(options.decision.map((d) => d.value)).toEqual([decisionKey]);
    expect(options.decision[0].label).toContain('critico');
    expect(options.others.map((o) => o.value)).not.toContain(decisionKey);
  });

  it('o filtro do usuário NUNCA remove achado de decisão', () => {
    const items = [finding(decisionKey), finding('GHSA-B|npm:outro@1.0.0')];
    const options = buildWaiverOptions({
      findings: { items, total: 2 },
      triage,
      filter: 'nao-casa-com-nada',
    });
    expect(options.decision).toHaveLength(1);
    expect(options.others).toEqual([]);
  });

  it('o filtro estreita só os demais achados', () => {
    const items = [
      finding(decisionKey),
      finding('GHSA-B|npm:nodemailer@8.0.7', { package_name: 'nodemailer' }),
      finding('GHSA-C|npm:uuid@9.0.1', { package_name: 'uuid' }),
    ];
    const options = buildWaiverOptions({ findings: { items, total: 3 }, triage, filter: 'uuid' });
    expect(options.decision).toHaveLength(1);
    expect(options.others.map((o) => o.value)).toEqual(['GHSA-C|npm:uuid@9.0.1']);
  });

  it('filtra por advisory e por versão, não só por nome de pacote', () => {
    const items = [
      finding('GHSA-B|npm:nodemailer@8.0.7', { package_name: 'nodemailer', advisory_id: 'GHSA-B' }),
      finding('GHSA-C|npm:uuid@9.0.1', { package_name: 'uuid', installed_version: '9.0.1' }),
    ];
    const porAdvisory = buildWaiverOptions({ findings: { items, total: 2 }, filter: 'ghsa-b' });
    const porVersao = buildWaiverOptions({ findings: { items, total: 2 }, filter: '9.0.1' });
    expect(porAdvisory.others.map((o) => o.value)).toEqual(['GHSA-B|npm:nodemailer@8.0.7']);
    expect(porVersao.others.map((o) => o.value)).toEqual(['GHSA-C|npm:uuid@9.0.1']);
  });

  it('capped é fato medido (total da API maior que o carregado) e nunca quando igual', () => {
    const items = [finding('GHSA-B|npm:outro@1.0.0')];
    expect(buildWaiverOptions({ findings: { items, total: 1 } }).capped).toBe(false);
    expect(buildWaiverOptions({ findings: { items, total: 2 } }).capped).toBe(true);
    expect(buildWaiverOptions({}).capped).toBe(false);
  });

  it('sem fila, todos os achados carregados ficam em "demais" (nenhum some)', () => {
    const items = Array.from({ length: 60 }, (_, i) => finding(`GHSA-A${i}|npm:outro${i}@1.0.0`));
    const options = buildWaiverOptions({ findings: { items, total: 60 } });
    expect(options.decision).toEqual([]);
    expect(options.others).toHaveLength(60);
    expect(options.capped).toBe(false);
  });
});
