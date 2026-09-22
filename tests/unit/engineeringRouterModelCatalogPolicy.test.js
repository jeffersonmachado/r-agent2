'use strict';

const { resolveCatalogStatus, isEligibleForRisk } = require('../../engine/engineeringRouter/modelCatalogPolicy');

describe('engineeringRouter/modelCatalogPolicy', () => {
  test('provider retorna modelo novo (não mapeado na allowlist) → DISCOVERED', () => {
    const status = resolveCatalogStatus({ isMapped: false, listedByProviderNow: true, previousStatus: null });
    expect(status).toBe('DISCOVERED');
  });

  test('modelo unclassified (DISCOVERED) nunca é elegível, nem para HIGH nem para CRITICAL', () => {
    expect(isEligibleForRisk('DISCOVERED', 'HIGH')).toBe(false);
    expect(isEligibleForRisk('DISCOVERED', 'CRITICAL')).toBe(false);
    expect(isEligibleForRisk('UNCLASSIFIED', 'HIGH')).toBe(false);
    expect(isEligibleForRisk('UNCLASSIFIED', 'CRITICAL')).toBe(false);
  });

  test('modelo CLASSIFIED (capability atribuída, ainda não promovido à allowlist estática) não é elegível', () => {
    expect(isEligibleForRisk('CLASSIFIED', 'LOW')).toBe(false);
  });

  test('modelo mapeado na allowlist estática (APPROVED) é elegível, para qualquer risco', () => {
    const status = resolveCatalogStatus({ isMapped: true, listedByProviderNow: true, previousStatus: null });
    expect(status).toBe('APPROVED');
    expect(isEligibleForRisk(status, 'LOW')).toBe(true);
    expect(isEligibleForRisk(status, 'CRITICAL')).toBe(true);
  });

  test('modelo mapeado mas o discovery real confirma que o provider deixou de listá-lo → RETIRED, nunca elegível', () => {
    const status = resolveCatalogStatus({ isMapped: true, listedByProviderNow: false, previousStatus: 'APPROVED' });
    expect(status).toBe('RETIRED');
    expect(isEligibleForRisk(status)).toBe(false);
  });

  test('discovery sem confirmação (fail-open, listedByProviderNow=null) preserva status mapeado como APPROVED', () => {
    const status = resolveCatalogStatus({ isMapped: true, listedByProviderNow: null, previousStatus: 'APPROVED' });
    expect(status).toBe('APPROVED');
  });

  test('modelId não mapeado e nunca confirmado por discovery real (listedByProviderNow=null) não gera ruído: cai em DISCOVERED por padrão, nunca elegível', () => {
    const status = resolveCatalogStatus({ isMapped: false, listedByProviderNow: null, previousStatus: null });
    expect(status).toBe('DISCOVERED');
    expect(isEligibleForRisk(status)).toBe(false);
  });

  test('status DENIED nunca é sobrescrito automaticamente, mesmo com discovery confirmando o modelo', () => {
    const status = resolveCatalogStatus({ isMapped: false, listedByProviderNow: true, previousStatus: 'DENIED' });
    expect(status).toBe('DENIED');
    expect(isEligibleForRisk(status)).toBe(false);
  });

  test('modelo já CLASSIFIED continua CLASSIFIED enquanto o discovery seguir confirmando sua existência (não regride para DISCOVERED)', () => {
    const status = resolveCatalogStatus({ isMapped: false, listedByProviderNow: true, previousStatus: 'CLASSIFIED' });
    expect(status).toBe('CLASSIFIED');
  });
});
