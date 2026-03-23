'use strict';

const fs = require('fs');
const path = require('path');

describe('rag/tenant cycle guardrail', () => {
  test('ragService no longer imports tenantService', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'api/services/ragService.js'), 'utf8');
    expect(source).not.toMatch(/require\('\.\/tenantService'\)/);
    expect(source).not.toMatch(/function\s+getTenantService\s*\(/);
  });

  test('ragDocumentsService no longer lazy-loads ragService', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'api/services/ragDocumentsService.js'), 'utf8');
    expect(source).toMatch(/const ragService = require\('\.\/ragService'\)/);
    expect(source).not.toMatch(/function\s+getRagService\s*\(/);
  });

  test('tenantService no longer lazy-loads ragDocumentsService', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'api/services/tenantService.js'), 'utf8');
    expect(source).toMatch(/const ragDocumentsService = require\('\.\/ragDocumentsService'\)/);
    expect(source).not.toMatch(/function\s+getRagDocumentsService\s*\(/);
  });
});
