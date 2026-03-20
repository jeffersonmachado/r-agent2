'use strict';

const fs = require('fs');
const path = require('path');

describe('extended residual cutover wiring', () => {
  test('registerRoutes monta routers migrados de operacoes extendidas', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createQueueTicketRoutes/);
    expect(source).toMatch(/createOpsRoutes/);
    expect(source).toMatch(/createExecutionLedgerRoutes/);
    expect(source).toMatch(/createSupportDebugRoutes/);

    expect(source).toMatch(/app\.use\(queueTicketRouter\)/);
    expect(source).toMatch(/app\.use\(opsRouter\)/);
    expect(source).toMatch(/app\.use\(executionLedgerRouter\)/);
    expect(source).toMatch(/app\.use\(supportDebugRouter\)/);
  });

  test('extended operations residual nao monta mais handlers legados de operacoes', () => {
    const residualModulePath = path.join(process.cwd(), 'api', 'modules', 'extended-residual');
    
    // extended-residual has been completely removed as part of domain-operations extraction
    expect(fs.existsSync(residualModulePath)).toBe(false);
  });
});
