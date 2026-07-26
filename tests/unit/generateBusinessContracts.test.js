'use strict';

/**
 * Regressão — confidence de jornadas existentes nunca era recalculada.
 *
 * Falha observada (2026-07-26): `generate-business-contracts.js` só gerava
 * contratos para jornadas NOVAS (`if (newContracts[journeyId]) continue`).
 * Jornadas com contrato existente mantinham a confidence congelada da época
 * da criação, mesmo após ganharem cenários reais — payment_charge_flow,
 * leads e food_customer_journey ficaram com "validação de contrato fraca"
 * no validate-business-needs apesar da cobertura ter crescido.
 *
 * Comportamento correto: o script recalcula a confidence das jornadas
 * existentes a partir do journey-coverage atual, preservando campos
 * declarados (requiredCapabilities, missingCapabilities e demais).
 */

const {
  computeConfidenceFromCounts,
  refreshJourneyContracts,
} = require('../../scripts/qa-waves/generate-business-contracts');

describe('computeConfidenceFromCounts (fórmula canônica)', () => {
  it('base 0.5 sem cenários e sem caps', () => {
    expect(computeConfidenceFromCounts(0, [])).toBe(0.5);
  });

  it('satura em 1 com 5 cenários e 6 caps', () => {
    expect(computeConfidenceFromCounts(5, ['a', 'b', 'c', 'd', 'e', 'f'])).toBe(1);
  });

  it('3 cenários e 1 capability = 0.71 (caso payment_charge_flow)', () => {
    expect(computeConfidenceFromCounts(3, ['billing_validation'])).toBe(0.71);
  });

  it('2 cenários e 3 capabilities = 0.72 (caso food_customer_journey)', () => {
    expect(computeConfidenceFromCounts(2, ['a', 'b', 'c'])).toBe(0.72);
  });
});

describe('refreshJourneyContracts (recálculo não destrutivo)', () => {
  it('atualiza confidence de jornada existente preservando campos declarados', () => {
    const contracts = {
      payment_charge_flow: {
        requiredCapabilities: ['billing_validation'],
        missingCapabilities: ['legacy_cap'],
        confidence: 0.53,
      },
    };
    const coverageByJourney = {
      payment_charge_flow: { vertical: 'core', scenarioCount: 3 },
    };

    const { contracts: refreshed, refreshed: ids } = refreshJourneyContracts(contracts, coverageByJourney);

    expect(ids).toEqual(['payment_charge_flow']);
    expect(refreshed.payment_charge_flow.confidence).toBe(0.71);
    expect(refreshed.payment_charge_flow.requiredCapabilities).toEqual(['billing_validation']);
    expect(refreshed.payment_charge_flow.missingCapabilities).toEqual(['legacy_cap']);
  });

  it('não cria contrato para jornada sem contrato existente', () => {
    const { contracts: refreshed, refreshed: ids } = refreshJourneyContracts({}, {
      nova_jornada: { vertical: 'core', scenarioCount: 5 },
    });

    expect(ids).toEqual([]);
    expect(refreshed.nova_jornada).toBeUndefined();
  });

  it('não toca jornadas fora do coverage informado', () => {
    const contracts = {
      outra_jornada: { requiredCapabilities: ['x'], missingCapabilities: [], confidence: 0.9 },
    };
    const { contracts: refreshed, refreshed: ids } = refreshJourneyContracts(contracts, {});

    expect(ids).toEqual([]);
    expect(refreshed.outra_jornada.confidence).toBe(0.9);
  });
});
