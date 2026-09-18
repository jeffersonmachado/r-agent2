'use strict';

/**
 * Autolimpeza das fixtures MCP órfãs + drivers do aviso de baixa confiança.
 *
 * Contexto: uma execução de Jest interrompida nunca roda o `afterAll` que purga
 * os tenants descartáveis; 17 linhas ficaram ENABLED no banco real e uma delas
 * (endpoint loopback) abortava a composição MCP inteira no startup. O isolamento
 * na fronteira impede o dano; aqui se prova o predicado que ataca a ORIGEM.
 *
 * Tudo o que este arquivo prova são FUNÇÕES PURAS — sem banco, sem disco.
 */

const { isStaleFixtureTenant, FIXTURE_TENANT_RE } = require('./helpers/realDatabase');
const { describeLowConfidenceDrivers } = require('../../../scripts/governance/validate-business-needs');

const HOUR = 3600000;
const NOW = 1789317000000; // instante fixo: determinismo

describe('isStaleFixtureTenant — origem do vazamento de fixtures', () => {
  test('reconhece o formato EXATO criado por uniqueTenantKey', () => {
    expect(FIXTURE_TENANT_RE.test('mcp-ssrf-1789316064079-d4ynu1')).toBe(true);
    expect(FIXTURE_TENANT_RE.test('mcp-eco-live-1789316065388-xsohmn')).toBe(true);
  });

  test('fixture antiga é órfã; fixture recente não é tocada', () => {
    const old = `mcp-ssrf-${NOW - 5 * HOUR}-d4ynu1`;
    const fresh = `mcp-ssrf-${NOW - 60_000}-d4ynu1`;

    expect(isStaleFixtureTenant(old, { now: NOW })).toBe(true);
    expect(isStaleFixtureTenant(fresh, { now: NOW })).toBe(false);
  });

  test('controle negativo: tenant REAL nunca casa (nada de apagar dado de produção)', () => {
    for (const real of ['system', 'academia-a', 'tenant-a', 'mcp-research', 'system-mcp']) {
      expect(isStaleFixtureTenant(real, { now: NOW })).toBe(false);
    }
  });

  test('controle negativo: formato parecido mas INVÁLIDO não casa', () => {
    for (const quase of [
      'mcp-ssrf-d4ynu1',                    // sem epoch
      'mcp-ssrf-1789316064079',             // sem rand
      'mcp-ssrf-1789316064079-d4ynu1-x',    // sufixo extra
      'MCP-ssrf-1789316064079-d4ynu1',      // caixa alta
      'prefixo-mcp-ssrf-1789316064079-d4ynu1',
    ]) {
      expect(isStaleFixtureTenant(quase, { now: NOW })).toBe(false);
    }
  });

  test('entrada vazia/estranha não explode e não casa', () => {
    for (const v of [null, undefined, '', 0, {}]) {
      expect(isStaleFixtureTenant(v, { now: NOW })).toBe(false);
    }
  });
});

describe('describeLowConfidenceDrivers — o aviso precisa nomear a causa', () => {
  test('nomeia vínculo fraco de cenário e poucas capabilities', () => {
    const driver = describeLowConfidenceDrivers({
      linkedScenarioCount: 1,
      requiredCapabilities: ['capability_scheduling'],
      hasDirectMatch: true,
    });
    expect(driver).toContain('1/5 cenários vinculados');
    expect(driver).toContain('1/6 capabilities');
  });

  test('sem vínculo nenhum e sem match direto, ambos aparecem', () => {
    const driver = describeLowConfidenceDrivers({
      linkedScenarioCount: 0,
      requiredCapabilities: [],
      hasDirectMatch: false,
    });
    expect(driver).toContain('0/5 cenários vinculados');
    expect(driver).toContain('sem match direto de jornada');
  });

  test('cenário vinculado desconhecido não inventa número', () => {
    const driver = describeLowConfidenceDrivers({
      linkedScenarioCount: null,
      requiredCapabilities: ['a', 'b', 'c', 'd', 'e', 'f'],
      hasDirectMatch: true,
    });
    expect(driver).toBe('sem driver identificado');
  });

  test('entrada vazia é segura (nunca lança)', () => {
    expect(typeof describeLowConfidenceDrivers()).toBe('string');
    expect(typeof describeLowConfidenceDrivers({})).toBe('string');
  });
});
