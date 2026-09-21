'use strict';

/**
 * T18 — classificação do system-scope-audit. Regenerado em 2026-09-20 (T17
 * colocou o produtor no converge), o audit flaggou duas ocorrências como
 * RUNTIME_FAIL_OPEN:
 *
 *   1. api/modules/benchmark-research/routes.js — `... || 'system'` no tenant
 *      do run de pesquisa. Benchmark research é pipeline INTERNO da plataforma
 *      (SYSTEM_INTERNAL/DEVELOPMENT; o tenant do run é SYSTEM por contrato,
 *      resolvido em `authenticate`) — mesma classe da família qawaves e de
 *      testexecution, já declaradas LEGITIMATE_PLATFORM_SYSTEM.
 *   2. api/services/pbx/pbxDialplanService.js — `PBX_ASTERISK_STATIC_CONTEXTS
 *      || 'system'`: 'system' é o NOME DO CONTEXTO ESTÁTICO do dialplan do
 *      Asterisk (namespace de dialplan), não escopo de dados de tenant —
 *      classe STATIC_CONFIG.
 *
 * Nenhuma das duas é fallback de escopo de dados; classificá-las corretamente
 * NÃO é afrouxamento — RUNTIME_FAIL_OPEN continua FAIL para fallback real.
 *
 * T32 (2026-09-21): o Engineering Model Router V1 introduziu
 * `ENGINEERING_ROUTER_TENANT_ID || 'system'` em engineeringAiInvoker e
 * engineeringModelAvailabilityService. As rotas do módulo exigem
 * checkClassification('DEVELOPMENT') server-side e a superfície opera sobre a
 * própria plataforma (mesma classe qawaves/testexecution) — o default 'system'
 * é o tenant de plataforma, não escopo de dados de negócio.
 */

const { classifyOccurrence } = require('../../../scripts/governance/generate-system-scope-audit');

describe('system-scope-audit — classificação de ocorrências', () => {
  it('benchmark-research: pipeline interno da plataforma (tenant SYSTEM por contrato)', () => {
    expect(classifyOccurrence(
      '/opt/results/ria/r-agent2/api/modules/benchmark-research/routes.js',
      "const researchTenant = injected.tenantId || context.tenantId || 'system';",
    )).toBe('LEGITIMATE_PLATFORM_SYSTEM');
  });

  it('pbxDialplanService static contexts: nome de contexto do dialplan, não escopo de tenant', () => {
    expect(classifyOccurrence(
      '/opt/results/ria/r-agent2/api/services/pbx/pbxDialplanService.js',
      "return String(process.env.PBX_ASTERISK_STATIC_CONTEXTS || 'system')",
    )).toBe('STATIC_CONFIG');
  });

  it('engineeringRouter (services): superfície DEVELOPMENT-only de engenharia da plataforma', () => {
    expect(classifyOccurrence(
      '/opt/results/ria/r-agent2/api/services/engineeringRouter/engineeringAiInvoker.js',
      "const DEFAULT_TENANT_ID = process.env.ENGINEERING_ROUTER_TENANT_ID || 'system';",
    )).toBe('LEGITIMATE_PLATFORM_SYSTEM');
  });

  it('engineering-router (modules): rotas com checkClassification(DEVELOPMENT) server-side', () => {
    expect(classifyOccurrence(
      '/opt/results/ria/r-agent2/api/modules/engineering-router/engineeringRouter.routes.js',
      "const tenantId = process.env.ENGINEERING_ROUTER_TENANT_ID || 'system';",
    )).toBe('LEGITIMATE_PLATFORM_SYSTEM');
  });

  it('fallback real de tenant em serviço vertical continua RUNTIME_FAIL_OPEN', () => {
    expect(classifyOccurrence(
      '/opt/results/ria/r-agent2/api/services/verticalFitnessService.js',
      "const tenantId = req.tenantId || 'system';",
    )).toBe('RUNTIME_FAIL_OPEN');
  });

  it('fallback real de tenant em serviço genérico continua RUNTIME_FAIL_OPEN', () => {
    expect(classifyOccurrence(
      '/opt/results/ria/r-agent2/api/services/qualquerService.js',
      "const tenantId = context.tenantId || 'system';",
    )).toBe('RUNTIME_FAIL_OPEN');
  });
});
