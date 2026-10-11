import { describe, it, expect } from 'vitest';
import {
  PENDING_WAIVER_STATE,
  ACTIVE_WAIVER_STATE,
  semCorrecaoPublicada,
  somenteDev,
  indexWaiversByFinding,
  pendingWaiverFindingKeys,
  selectPendingFindings,
  summarizePendingFindings,
} from './pendingFindings.js';

const achado = (key, extra = {}) => ({
  finding_key: key,
  package_name: key.split('|')[1] || key,
  severity: 'HIGH',
  status: 'FIX_AVAILABLE',
  ...extra,
});

const waiver = (key, state, extra = {}) => ({
  waiver_key: `w-${key}`,
  finding_key: key,
  state,
  expires_at: '2026-11-01T00:00:00.000Z',
  ...extra,
});

describe('semCorrecaoPublicada', () => {
  it('reconhece apenas NO_FIX_AVAILABLE como ausência de correção', () => {
    expect(semCorrecaoPublicada({ status: 'NO_FIX_AVAILABLE' })).toBe(true);
    expect(semCorrecaoPublicada({ status: 'FIX_AVAILABLE' })).toBe(false);
    expect(semCorrecaoPublicada({ status: 'UNDER_INVESTIGATION' })).toBe(false);
    expect(semCorrecaoPublicada(null)).toBe(false);
  });
});

describe('selectPendingFindings — o que exige decisão humana', () => {
  it('NÃO trata severidade alta com correção disponível como pendência', () => {
    // Regressão do defeito medido com o operador em 2026-10-11: o critério
    // anterior (`NO_FIX_AVAILABLE || CRITICAL/HIGH`) mantinha 86 de 146 achados
    // e o filtro parecia não fazer nada.
    const findings = {
      items: [
        achado('A|npm:pacote-a@1.0.0', { severity: 'CRITICAL', status: 'FIX_AVAILABLE' }),
        achado('B|npm:pacote-b@1.0.0', { severity: 'HIGH', status: 'FIX_AVAILABLE' }),
        achado('C|npm:pacote-c@1.0.0', { severity: 'LOW', status: 'NO_FIX_AVAILABLE' }),
      ],
      total: 3,
    };
    const pendentes = selectPendingFindings({ findings, waivers: { items: [] } });
    expect(pendentes.map((row) => row.finding_key)).toEqual(['C|npm:pacote-c@1.0.0']);
  });

  it('inclui achado cuja isenção aguarda aprovação', () => {
    const findings = {
      items: [
        achado('A|npm:pacote-a@1.0.0'),
        achado('B|npm:pacote-b@1.0.0'),
      ],
    };
    const waivers = { items: [waiver('B|npm:pacote-b@1.0.0', PENDING_WAIVER_STATE)] };
    const pendentes = selectPendingFindings({ findings, waivers });
    expect(pendentes.map((row) => row.finding_key)).toEqual(['B|npm:pacote-b@1.0.0']);
  });

  it('não considera pendência a isenção já aprovada (ACTIVE)', () => {
    const findings = { items: [achado('A|npm:pacote-a@1.0.0')] };
    const waivers = { items: [waiver('A|npm:pacote-a@1.0.0', ACTIVE_WAIVER_STATE)] };
    expect(selectPendingFindings({ findings, waivers })).toEqual([]);
  });

  it('é não-vacuo: com dado realista o filtro corta de fato a lista', () => {
    const items = [];
    for (let i = 0; i < 40; i += 1) items.push(achado(`F${i}|npm:pacote-${i}@1.0.0`, { severity: 'HIGH' }));
    for (let i = 40; i < 43; i += 1) items.push(achado(`F${i}|npm:pacote-${i}@1.0.0`, { status: 'NO_FIX_AVAILABLE' }));
    const findings = { items, total: items.length };
    const pendentes = selectPendingFindings({ findings, waivers: { items: [] } });
    expect(pendentes).toHaveLength(3);
    expect(pendentes.length).toBeLessThan(items.length);
  });

  it('tolera ausência de dados sem inventar pendência', () => {
    expect(selectPendingFindings()).toEqual([]);
    expect(selectPendingFindings({ findings: {}, waivers: {} })).toEqual([]);
  });
});

describe('indexWaiversByFinding', () => {
  it('separa isenção pendente de vigente por achado', () => {
    const index = indexWaiversByFinding({
      items: [
        waiver('A|npm:a@1.0.0', PENDING_WAIVER_STATE),
        waiver('B|npm:b@1.0.0', ACTIVE_WAIVER_STATE),
      ],
    });
    expect(index.get('A|npm:a@1.0.0').pending).toBeTruthy();
    expect(index.get('A|npm:a@1.0.0').active).toBeNull();
    expect(index.get('B|npm:b@1.0.0').active).toBeTruthy();
    expect(index.get('B|npm:b@1.0.0').pending).toBeNull();
  });

  it('ignora registro sem chave de achado', () => {
    const index = indexWaiversByFinding({ items: [{ state: PENDING_WAIVER_STATE }] });
    expect(index.size).toBe(0);
  });

  it('pendingWaiverFindingKeys devolve só as aguardando aprovação', () => {
    const keys = pendingWaiverFindingKeys({
      items: [waiver('A|npm:a@1.0.0', PENDING_WAIVER_STATE), waiver('B|npm:b@1.0.0', 'REVOKED')],
    });
    expect([...keys]).toEqual(['A|npm:a@1.0.0']);
  });
});

describe('summarizePendingFindings — feedback do filtro', () => {
  it('declara total carregado, pendentes e a quebra por motivo', () => {
    const loaded = [
      achado('A|npm:a@1.0.0'),
      achado('B|npm:b@1.0.0', { status: 'NO_FIX_AVAILABLE' }),
      achado('C|npm:c@1.0.0'),
    ];
    const pending = selectPendingFindings({
      findings: { items: loaded },
      waivers: { items: [waiver('C|npm:c@1.0.0', PENDING_WAIVER_STATE)] },
    });
    const resumo = summarizePendingFindings({ loaded, pending });
    expect(resumo).toEqual({
      loadedTotal: 3,
      pendingTotal: 2,
      semCorrecao: 1,
      aguardandoAprovacao: 1,
      devOnly: 0,
      bloqueantes: 2,
    });
  });

  it('separa o que BLOQUEIA do que é só aviso (dependência de build/teste)', () => {
    // O gate chama estes de `DEV_ONLY_VULNERABILITY` (aviso). A tela não pode
    // somar os dois na mesma conta: em 2026-10-11 `braces`/`sprintf-js` (dev-only)
    // apareciam como pendência idêntica a um bloqueante de runtime.
    const loaded = [
      achado('A|npm:a@1.0.0', { status: 'NO_FIX_AVAILABLE' }),
      achado('B|npm:b@1.0.0', { status: 'NO_FIX_AVAILABLE', dev_only: true }),
      achado('C|npm:c@1.0.0', { status: 'NO_FIX_AVAILABLE', dev_only: true }),
    ];
    const pending = selectPendingFindings({ findings: { items: loaded }, waivers: { items: [] } });
    const resumo = summarizePendingFindings({ loaded, pending });
    expect(resumo.pendingTotal).toBe(3);
    expect(resumo.devOnly).toBe(2);
    expect(resumo.bloqueantes).toBe(1);
  });

  it('somenteDev só reconhece o flag booleano verdadeiro', () => {
    expect(somenteDev({ dev_only: true })).toBe(true);
    expect(somenteDev({ dev_only: false })).toBe(false);
    expect(somenteDev({})).toBe(false);
    expect(somenteDev(null)).toBe(false);
  });

  it('sem dado devolve zeros (nunca NaN)', () => {
    expect(summarizePendingFindings()).toEqual({
      loadedTotal: 0, pendingTotal: 0, semCorrecao: 0, aguardandoAprovacao: 0, devOnly: 0, bloqueantes: 0,
    });
  });
});
