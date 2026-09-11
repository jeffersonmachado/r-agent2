'use strict';

/**
 * MISSÃO CORRETIVA §20–§41 (verificação real, sem inventar contrato).
 *
 * O contrato EVO instruía rodar `npm run validate:evo-contract` — comando que
 * não existia. Um gate citado e inexistente é política decorativa. Estes testes
 * provam que o gate existe, que ele é NÃO VACUOSO (cada violação dispara quando
 * a condição é violada) e que a consulta à documentação oficial ficou registrada
 * com o resultado NEGATIVO real.
 */

const fs = require('fs');
const path = require('path');

const {
  validateContract,
  VIOLATION_CODES,
  CONTRACT_PATH,
  CLIENT_PATH,
  ADAPTER_PATH,
  REPORT_PATH,
} = require('../../scripts/governance/validate-evo-contract');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const CLIENT_SOURCE = fs.readFileSync(CLIENT_PATH, 'utf8');
const SUPPORTED = require(ADAPTER_PATH).SUPPORTED_RESOURCES;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function codes(violations) {
  return violations.map((v) => v.code);
}

function validate(overrides = {}, context = {}) {
  const contract = clone(CONTRACT);
  overrides(contract);
  return validateContract(contract, {
    clientSource: CLIENT_SOURCE,
    supportedResources: SUPPORTED,
    ...context,
  });
}

describe('§20 o gate do contrato EVO existe e é executável', () => {
  it('está registrado no package.json (o contrato o cita, então ele precisa existir)', () => {
    expect(typeof PKG.scripts['validate:evo-contract']).toBe('string');
    expect(PKG.scripts['validate:evo-contract']).toContain('validate-evo-contract.js');
  });

  it('está no gate agregado de governança', () => {
    expect(PKG.scripts['validate:governance-enforcement']).toContain('validate:evo-contract');
  });

  it('o contrato real PASSA (o gate não é vacuoso nem sempre-vermelho)', () => {
    expect(validateContract(CONTRACT, { clientSource: CLIENT_SOURCE, supportedResources: SUPPORTED }).violations).toEqual([]);
  });

  it('o relatório é gerado com o estado de certificação observado', () => {
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    expect(report.gate).toBe('validate-evo-contract');
    expect(report.status).toBe('PASS');
    expect(report.certificationStatus).toBe('UNVERIFIED');
  });
});

describe('§20 o gate FALHA quando a governança do contrato é violada', () => {
  it('readOnly deixar de ser verdadeiro falha', () => {
    expect(codes(validate((c) => { c.readOnly = false; }).violations)).toContain(VIOLATION_CODES.READONLY_VIOLATED);
  });

  it('estrutura incompleta falha listando o que falta', () => {
    const result = validate((c) => { delete c.resources.members.detailPath; });
    expect(codes(result.violations)).toContain(VIOLATION_CODES.STRUCTURE_INCOMPLETE);
  });

  it('declarar CERTIFIED sem evidência falha', () => {
    const result = validate((c) => { c._certification.status = 'CERTIFIED'; });
    const violation = result.violations.find((v) => v.code === VIOLATION_CODES.CERTIFICATION_CLAIM_WITHOUT_EVIDENCE);
    expect(violation).toBeDefined();
    expect(violation.missingEvidence).toEqual(expect.arrayContaining(['certifiedAt', 'certifiedBy', 'verifiedAgainst']));
  });

  it('rótulo UNVERIFIED que reivindica LIVE VERIFIED falha', () => {
    const result = validate((c) => { c._certification.honestLabel = 'LIVE VERIFIED'; });
    expect(codes(result.violations)).toContain(VIOLATION_CODES.UNVERIFIED_LABEL_DISHONEST);
  });

  it('guard declarado sem implementação no cliente falha', () => {
    const result = validateContract(CONTRACT, { clientSource: '// sem guard', supportedResources: SUPPORTED });
    expect(codes(result.violations)).toContain(VIOLATION_CODES.GUARD_NOT_ENFORCED);
  });

  it('recurso no contrato que o provider não suporta falha', () => {
    const result = validate((c) => { c.resources.invented = { path: '/invented', detailPath: '/invented/{id}', fields: { externalId: ['id'] } }; });
    const violation = result.violations.find((v) => v.code === VIOLATION_CODES.RESOURCE_NOT_SUPPORTED);
    expect(violation).toBeDefined();
    expect(violation.unsupported).toContain('invented');
  });

  it('recurso suportado ausente do contrato também falha', () => {
    const result = validate((c) => { delete c.resources.prospects; });
    const violation = result.violations.find((v) => v.code === VIOLATION_CODES.RESOURCE_NOT_SUPPORTED);
    expect(violation).toBeDefined();
    expect(violation.unmapped).toContain('prospects');
  });

  it('rate limit apresentado como documentado sem fonte falha', () => {
    const result = validate((c) => { c.rateLimit.documented = true; delete c.rateLimit.source; });
    expect(codes(result.violations)).toContain(VIOLATION_CODES.RATE_LIMIT_CLAIMED_WITHOUT_DOC);
  });
});

describe('§21 a consulta oficial está registrada com o resultado real', () => {
  it('registra as URLs oficiais consultadas com status HTTP', () => {
    const consultation = CONTRACT._officialDocsConsultation;
    expect(consultation.consultedAt).toBe('2026-09-11');
    const urls = consultation.sources.map((s) => s.url);
    expect(urls).toContain('https://docs.evo.com.br/');
    expect(urls).toContain('https://docs.evo.com.br/api');
    expect(urls).toContain('https://financeiro-evo.azurewebsites.net/docs/API_v1/swagger.json');
    expect(consultation.sources.every((s) => Object.prototype.hasOwnProperty.call(s, 'covers'))).toBe(true);
  });

  it('declara que a documentação pública NÃO cobre a API de integração', () => {
    const consultation = CONTRACT._officialDocsConsultation;
    for (const source of consultation.sources) {
      expect(typeof source.doesNotCover).toBe('string');
    }
    expect(consultation.conclusion).toMatch(/não cobre|NAO COBRE|negativo/i);
  });

  it('registra o achado de autenticação e proíbe a confusão com a API Financeiro', () => {
    expect(CONTRACT._officialDocsConsultation.authModelFinding).toMatch(/client credentials|IDENTITY\/TOKEN/i);
    // O contrato de integração NÃO adota o dialeto da API Financeiro.
    expect(String(CONTRACT.auth.type).toLowerCase()).toBe('basic');
    expect(CONTRACT.auth.identityTokenPath).toBeUndefined();
  });

  it('transportar o dialeto da API Financeiro para a integração falha', () => {
    const result = validate((c) => { c.auth.type = 'client_credentials'; });
    expect(codes(result.violations)).toContain(VIOLATION_CODES.AUTH_DIALECT_CONFLATED_WITH_FINANCE_API);
  });

  it('veredito honesto: sem credencial real o contrato permanece UNVERIFIED', () => {
    expect(CONTRACT._certification.status).toBe('UNVERIFIED');
    expect(CONTRACT._certification.mustNotClaim).toBe('LIVE VERIFIED');
    expect(CONTRACT._certification.honestLabel).toContain('AWAITING EVO LIVE CREDENTIAL CERTIFICATION');
    expect(CONTRACT._officialDocsConsultation.verifiedAgainst).toEqual([]);
  });

  it('o webhook declara que o cabeçalho de assinatura é contrato do lado RAP, não fato verificado', () => {
    expect(CONTRACT.webhook.signatureHeader).toBe('x-evo-signature');
    expect(CONTRACT.webhook.verificationStatus).toBe('UNVERIFIED');
    // Fail-closed é exigido: sem segredo configurado o webhook é rejeitado.
    const adapter = fs.readFileSync(ADAPTER_PATH, 'utf8');
    expect(adapter).toContain('x-evo-signature');
    expect(adapter).toContain('signature_header_missing');
  });
});
