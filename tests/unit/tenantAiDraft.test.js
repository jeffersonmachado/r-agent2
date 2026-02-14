const fs = require('fs');
const path = require('path');
const tenantContract = require('../../contracts/tenant.contract.json');
const { validateTenantDraft, createTenantAiDraft } = require('../../api/services/tenantAiDraft');

describe('Tenant AI Draft - contrato + semântica + safe-mode', () => {
  test('deve aceitar draft válido', () => {
    const p = path.join(__dirname, '../fixtures/ai/tenant.draft.valid.json');
    const draft = JSON.parse(fs.readFileSync(p, 'utf8'));

    const res = validateTenantDraft(draft, tenantContract);
    expect(res.valid).toBe(true);
    expect(res.riskFlags).toEqual(expect.arrayContaining(['PENDING_REVIEW']));
  });

  test('createTenantAiDraft deve sempre forçar pending_review e integrações OFF', () => {
    const aiOutput = {
      name: 'Minha Empresa',
      site: 'https://example.com',
      ramo_atividade: 'Ramo de atividade suficientemente descritivo para passar no contrato.',
      objetivo: 'Objetivo suficientemente descritivo para passar no contrato.',
      status: 'active', // tentativa maliciosa
      settings: { externalIntegrationsEnabled: true }, // tentativa maliciosa
    };

    const res = createTenantAiDraft(aiOutput, {
      tenantContractPath: 'contracts/tenant.contract.json',
      tenant_key: 'tenant-minha-empresa',
    });

    expect(res.tenantDraft.status).toBe('pending_review');
    expect(res.tenantDraft.settings.externalIntegrationsEnabled).toBe(false);
    expect(res.tenantDraft.settings.webScrapingEnabled).toBe(false);
  });

  test('createTenantAiDraft deve truncar objetivo/ramo_atividade quando ultrapassar maxLength do contrato', () => {
    const long = 'x'.repeat(800);
    const res = createTenantAiDraft({
      name: 'Empresa Longa',
      site: 'https://example.com',
      ramo_atividade: `Ramo ${long}`,
      objetivo: `Objetivo ${long}`,
    }, {
      tenantContractPath: 'contracts/tenant.contract.json',
      tenant_key: 'empresa-longa',
    });

    expect(res.tenantDraft.objetivo.length).toBeLessThanOrEqual(500);
    expect(res.tenantDraft.ramo_atividade.length).toBeLessThanOrEqual(500);
    expect(res.warnings.some(w => w.code === 'FIELDS_TRUNCATED')).toBe(true);
    // AJV não deve falhar por maxLength
    expect(res.errors.some(e => e.code === 'TENANT_CONTRACT_AJV_FAILED')).toBe(false);
  });

  test('deve rejeitar draft com campo sensível (apiKey)', () => {
    const p = path.join(__dirname, '../fixtures/ai/tenant.draft.withSecret.json');
    const draft = JSON.parse(fs.readFileSync(p, 'utf8'));

    const res = validateTenantDraft(draft, tenantContract);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.code === 'SENSITIVE_FIELDS_FORBIDDEN')).toBe(true);
  });
});

