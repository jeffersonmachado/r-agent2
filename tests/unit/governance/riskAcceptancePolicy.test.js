'use strict';

/**
 * tests/unit/governance/riskAcceptancePolicy.test.js
 *
 * Missão L-1 FINAL §8 — TESTES ADVERSARIAIS OBRIGATÓRIOS (20 cenários).
 *
 * Regra que estes testes protegem: **aceite de risco não é resolução**, não pode ser produzido pelo
 * agente, não vale fora do escopo/commit/risco declarado, expira, é revogável e nunca dispensa
 * categoria não dispensável (§4). Os cenários 1–19 precisam REPROVAR; o 20 precisa PASSAR.
 *
 * A chave privada usada aqui é FIXTURE DE TESTE, gerada em memória a cada execução: ela não aprova
 * risco nenhum no repositório — serve para provar que a verificação de assinatura funciona nos dois
 * sentidos (válida e inválida).
 */

const crypto = require('crypto');

const policy = require('../../../governance/risk-acceptance/policy');
const sig = require('../../../governance/risk-acceptance/signature');

const DECISAO = 'ENGINEER_SUPERVISED_READINESS';
const COMMIT = 'a'.repeat(40);
const AGORA = Date.parse('2026-10-21T04:00:00.000Z');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

const AUTORIDADE = {
  identity: 'owner@results.com.br',
  authority: 'PLATFORM_OWNER',
  mayAcceptRisks: true,
  decisions: [DECISAO],
  publicKeyPem,
  registeredAt: '2026-10-20T00:00:00.000Z',
};

function aceiteBase(overrides = {}) {
  const base = {
    riskId: 'H15-DIST-RECIBO-STALE',
    riskDescription: 'recibo STALE do verifier no dist/',
    severity: 'P2',
    affectedScope: ['RELEASE_CERTIFICATION_READINESS'],
    allowedScope: [DECISAO],
    prohibitedScope: ['release', 'publicacao', 'main', 'aprovacao_humana'],
    justification: 'Risco restrito ao ciclo de embalagem; a cadeia do Engenheiro nao consome dist/ e a prova de L-1 independe do payload entregue.',
    residualImpact: 'O recibo stale pode mascarar uma checagem de dist em um ciclo de release futuro.',
    compensatingControls: ['validate:dist continua bloqueante no gate de release e sera reexecutado em todo ciclo de selagem.'],
    approvedBy: 'Jefferson Carlos Machado',
    approverIdentity: AUTORIDADE.identity,
    approverAuthority: AUTORIDADE.authority,
    approvedAt: '2026-10-21T03:00:00.000Z',
    expiresAt: '2026-11-21T03:00:00.000Z',
    sourceCommit: COMMIT,
    evidenceReferences: ['AI_MEMORY/hardening-queue.json'],
    simulated: false,
    ...overrides,
  };
  if (overrides.approvalArtifactHash === undefined) base.approvalArtifactHash = sig.hashDoPayload(base);
  if (overrides.signature === undefined) {
    base.signature = {
      algorithm: 'ed25519',
      keyId: AUTORIDADE.identity,
      value: crypto.sign(null, Buffer.from(sig.construirPayload(base), 'utf8'), privateKey).toString('base64'),
    };
  }
  return base;
}

function ctx(overrides = {}) {
  return {
    riskId: 'H15-DIST-RECIBO-STALE',
    sourceCommit: COMMIT,
    decisao: DECISAO,
    autoridades: [AUTORIDADE],
    categorias: [],
    agora: AGORA,
    existeArquivo: () => true,
    ...overrides,
  };
}

function motivosDe(resultado) {
  return resultado.motivos.join(' | ');
}

describe('aceite de risco — 20 cenários adversariais (§8)', () => {
  test('1. nenhum aceite presente NUNCA vira ACCEPTED_RISK', () => {
    const r = policy.resolverItemBloqueado(
      { id: 'H15-DIST-RECIBO-STALE', status: 'blocked_external' },
      { class: 'RELEASE_ONLY', ownedBy: 'RELEASE_CERTIFICATION_READINESS', justification: 'x'.repeat(80), evidenceReferences: ['AI_MEMORY/hardening-queue.json'] },
      ctx(),
    );
    expect(r.estado).not.toBe('ACCEPTED_RISK');
    expect(r.estado).toBe('NOT_APPLICABLE');
  });

  test('2. aceite com identidade ausente é recusado', () => {
    const a = aceiteBase({ approverIdentity: '', approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    expect(policy.validarAceite(a, ctx()).ok).toBe(false);
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('IDENTIDADE_AUSENTE');
  });

  test('3. aceite produzido pelo agente é recusado', () => {
    const a = aceiteBase({ approverIdentity: 'copilot-agent', approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    a.signature = { algorithm: 'ed25519', keyId: 'copilot-agent', value: 'AAAA' };
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('IDENTIDADE_DE_AGENTE');
  });

  test('4. aceite de identidade sem autoridade registrada é recusado', () => {
    const a = aceiteBase({ approverIdentity: 'estranho@fora.com', approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('AUTORIDADE_NAO_REGISTRADA');
  });

  test('5. aceite expirado é recusado', () => {
    const a = aceiteBase({ expiresAt: '2026-10-21T03:30:00.000Z', approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    a.signature = { algorithm: 'ed25519', keyId: AUTORIDADE.identity, value: crypto.sign(null, Buffer.from(sig.construirPayload(a), 'utf8'), privateKey).toString('base64') };
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('ACEITE_EXPIRADO');
  });

  test('6. aceite revogado é recusado', () => {
    const r = policy.validarAceite(aceiteBase(), ctx({ revogados: ['H15-DIST-RECIBO-STALE'] }));
    expect(r.ok).toBe(false);
    expect(motivosDe(r)).toContain('ACEITE_REVOGADO');
  });

  test('7. aceite de outro commit é recusado', () => {
    const a = aceiteBase({ sourceCommit: 'b'.repeat(40), approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    a.signature = { algorithm: 'ed25519', keyId: AUTORIDADE.identity, value: crypto.sign(null, Buffer.from(sig.construirPayload(a), 'utf8'), privateKey).toString('base64') };
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('ACEITE_DE_OUTRO_COMMIT');
  });

  test('8. aceite para outro escopo é recusado', () => {
    const a = aceiteBase({ allowedScope: ['PLATFORM_PRODUCTION_READINESS'], approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    a.signature = { algorithm: 'ed25519', keyId: AUTORIDADE.identity, value: crypto.sign(null, Buffer.from(sig.construirPayload(a), 'utf8'), privateKey).toString('base64') };
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('ESCOPO_NAO_COBRE_A_DECISAO');
  });

  test('9. aceite para outro risco é recusado', () => {
    const a = aceiteBase({ riskId: 'OUTRO-RISCO', approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    a.signature = { algorithm: 'ed25519', keyId: AUTORIDADE.identity, value: crypto.sign(null, Buffer.from(sig.construirPayload(a), 'utf8'), privateKey).toString('base64') };
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('RISCO_DIFERENTE_DO_ITEM');
  });

  test('10. aceite sem controles compensatórios é recusado', () => {
    const a = aceiteBase({ compensatingControls: [], approvalArtifactHash: undefined, signature: undefined });
    a.approvalArtifactHash = sig.hashDoPayload(a);
    a.signature = { algorithm: 'ed25519', keyId: AUTORIDADE.identity, value: crypto.sign(null, Buffer.from(sig.construirPayload(a), 'utf8'), privateKey).toString('base64') };
    expect(motivosDe(policy.validarAceite(a, ctx()))).toContain('CONTROLES_COMPENSATORIOS_AUSENTES');
  });

  test('11. aceite com evidência inexistente é recusado', () => {
    const r = policy.validarAceite(aceiteBase(), ctx({ existeArquivo: () => false }));
    expect(r.ok).toBe(false);
    expect(motivosDe(r)).toContain('EVIDENCIA_INEXISTENTE');
  });

  test('12. aceite com hash inválido (campo editado após assinatura) é recusado', () => {
    const a = aceiteBase();
    a.justification = `${a.justification} (editado depois da assinatura)`;
    const r = policy.validarAceite(a, ctx());
    expect(r.ok).toBe(false);
    expect(motivosDe(r)).toContain('HASH_DO_ACEITE_DIVERGENTE');
  });

  test('13. aceite de P0 não dispensável (OPEN_P0_IN_SCOPE) é recusado mesmo válido', () => {
    const r = policy.validarAceite(aceiteBase(), ctx({ categorias: ['OPEN_P0_IN_SCOPE'] }));
    expect(r.ok).toBe(false);
    expect(motivosDe(r)).toContain('CATEGORIA_NAO_DISPENSAVEL:OPEN_P0_IN_SCOPE');
  });

  test('14. aceite de violação multi-tenant é recusado', () => {
    const r = policy.validarAceite(aceiteBase(), ctx({ categorias: ['TENANT_ISOLATION_VIOLATION'] }));
    expect(r.ok).toBe(false);
    expect(motivosDe(r)).toContain('TENANT_ISOLATION_VIOLATION');
  });

  test('15. aceite de falso PASS é recusado', () => {
    const r = policy.validarAceite(aceiteBase(), ctx({ categorias: ['FALSE_PASS'] }));
    expect(r.ok).toBe(false);
    expect(motivosDe(r)).toContain('FALSE_PASS');
  });

  test('16. roteamento não pode transformar risco não dispensável em NOT_APPLICABLE', () => {
    const r = policy.resolverItemBloqueado(
      { id: 'X', status: 'blocked_external' },
      {
        class: 'PLATFORM_BLOCKING',
        ownedBy: 'PLATFORM_PRODUCTION_READINESS',
        categories: ['EVIDENCE_MANIPULATION'],
        justification: 'y'.repeat(80),
        evidenceReferences: ['AI_MEMORY/hardening-queue.json'],
      },
      ctx({ riskId: 'X' }),
    );
    expect(r.estado).toBe('BLOCKED');
    expect(motivosDe(r)).toContain('CATEGORIA_NAO_DISPENSAVEL:EVIDENCE_MANIPULATION');
  });

  test('17. roteamento para decisão inexistente (ou para a própria L-1) é recusado', () => {
    const r = policy.resolverItemBloqueado(
      { id: 'X', status: 'blocked_external' },
      { class: 'PLATFORM_BLOCKING', ownedBy: 'DECISAO_INVENTADA', justification: 'z'.repeat(80), evidenceReferences: ['AI_MEMORY/hardening-queue.json'] },
      ctx({ riskId: 'X' }),
    );
    expect(r.estado).toBe('BLOCKED');
    expect(motivosDe(r)).toContain('OWNER_INVALIDO');
  });

  test('18. RESOLVED_VERIFIED sem probe executável é recusado', () => {
    const r = policy.resolverItemBloqueado(
      { id: 'X', status: 'blocked_external' },
      { class: 'RESOLVED_VERIFIED', ownedBy: 'PLATFORM_PRODUCTION_READINESS', justification: 'w'.repeat(80), evidenceReferences: ['AI_MEMORY/hardening-queue.json'] },
      ctx({ riskId: 'X' }),
    );
    expect(r.estado).toBe('BLOCKED');
    expect(motivosDe(r)).toContain('RESOLUCAO_SEM_PROBE');
  });

  test('19. RESOLVED_VERIFIED com probe que FALHA é recusado (resolução não é afirmação)', () => {
    const r = policy.resolverItemBloqueado(
      { id: 'X', status: 'blocked_external' },
      { class: 'RESOLVED_VERIFIED', ownedBy: 'PLATFORM_PRODUCTION_READINESS', justification: 'w'.repeat(80), evidenceReferences: ['AI_MEMORY/hardening-queue.json'], probe: 'npm run --silent validate:nao-existe' },
      ctx({ riskId: 'X', executarProbe: () => ({ exitCode: 1, sha256Saida: 'x' }) }),
    );
    expect(r.estado).toBe('BLOCKED');
    expect(motivosDe(r)).toContain('PROBE_DE_RESOLUCAO_FALHOU');
  });

  test('20. aceite completo e válido é aceito — e continua sendo ACCEPTED_RISK, nunca RESOLVED', () => {
    const a = aceiteBase();
    const validacao = policy.validarAceite(a, ctx());
    expect(validacao.ok).toBe(true);
    expect(validacao.estado).toBe('ACCEPTED_RISK');

    const resolvido = policy.resolverItemBloqueado(
      { id: 'H15-DIST-RECIBO-STALE', status: 'blocked_external' },
      { class: 'RELEASE_ONLY', ownedBy: 'RELEASE_CERTIFICATION_READINESS', justification: 'q'.repeat(80), evidenceReferences: ['AI_MEMORY/hardening-queue.json'] },
      ctx({ aceite: a }),
    );
    expect(resolvido.estado).toBe('ACCEPTED_RISK');
    expect(resolvido.estado).not.toBe('RESOLVED_VERIFIED');
    expect(resolvido.detalhe.aprovadoPor).toBe(AUTORIDADE.identity);
  });
});
