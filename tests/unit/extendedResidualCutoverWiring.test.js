'use strict';

const fs = require('fs');
const path = require('path');

describe('extended residual cutover wiring', () => {
  test('registerRoutes monta routers migrados de operacoes extendidas', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    // Verify composition functions are imported
    expect(source).toMatch(/createQueueTicketExpressRouter/);
    expect(source).toMatch(/createOpsExpressRouter/);
    expect(source).toMatch(/createExecutionLedgerExpressRouter/);
    expect(source).toMatch(/createSupportDebugExpressRouter/);

    // Verify routers are registered in routeRegistry (indirectly mounted via registry loop)
    expect(source).toMatch(/queueTicketRouter/);
    expect(source).toMatch(/opsRouter/);
    expect(source).toMatch(/executionLedgerRouter/);
    expect(source).toMatch(/supportDebugRouter/);
  });

  test('extended operations residual nao monta mais handlers legados de operacoes', () => {
    const residualModulePath = path.join(process.cwd(), 'api', 'modules', 'extended-residual');
    
    // extended-residual has been completely removed as part of domain-operations extraction
    expect(fs.existsSync(residualModulePath)).toBe(false);
  });
});
