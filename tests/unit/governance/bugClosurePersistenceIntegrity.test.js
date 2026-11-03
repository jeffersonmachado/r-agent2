'use strict';

/**
 * MISSÃO CODEX — integridade de PERSISTÊNCIA do Bug Closure First (SHA 52d39fea2).
 *
 * Cada bloco abaixo reproduz um defeito P1 medido ANTES da correção:
 *
 *   A1 — transição legítima invalidava a própria prova ao recarregar o inventário
 *        (`fromState` era comparado com o estado PERSISTIDO, que já é o `toState`).
 *   A2 — o verificador só conferia existência/ordem do evento no livro; um evento com
 *        `from`/`to`/`proofHash`/`actorId`/`evaluatedCommit`/`kind` divergentes passava.
 *   A3 — `applyAttestation` anexava o evento ao livro ANTES de validar o caminho da prova:
 *        operação recusada deixava evento órfão no livro append-only.
 *
 * Os testes usam filesystem REAL e prova assinada com autoridade de TESTE (nunca promovida
 * à configuração de release).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const proof = require('../../../governance/bug-closure/closure-proof');
const ledger = require('../../../governance/bug-closure/transition-ledger');
const service = require('../../../governance/bug-closure/transition-service');
const registry = require('../../../governance/bug-closure/defect-registry');
const eligibility = require('../../../governance/bug-closure/eligibility');
const sig = require('../../../governance/risk-acceptance/signature');
const TA = require('../../../governance/bug-closure/trusted-authorities');

const SHA = 'a'.repeat(40);
const FP = 'b'.repeat(64);

/** Cenário completo: raiz temporária, autoridade de teste, fila e prova assinada. */
function cenario({ estado = 'FIXED_PENDING_VERIFICATION', toState = 'VERIFIED' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-'));
  fs.mkdirSync(path.join(root, 'AI_MEMORY'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'unit', 'regressao.test.js'), '// ok\n', 'utf8');
  fs.mkdirSync(path.join(root, 'prova-saida'), { recursive: true });
  fs.writeFileSync(path.join(root, 'prova-saida', 'regressao.log'), 'PASS\n', 'utf8');

  const outHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'prova-saida', 'regressao.log'))).digest('hex');
  const testHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'tests', 'unit', 'regressao.test.js'))).digest('hex');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const fingerprint = TA.fingerprintDaChavePem(pem);
  fs.mkdirSync(path.join(root, 'governance', 'risk-acceptance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance', 'risk-acceptance', 'authorities.json'), JSON.stringify({
    authorities: [{
      identity: 'owner@example.invalid', authority: 'PLATFORM_OWNER', mayCloseDefects: true, publicKeyPem: pem,
    }],
  }, null, 2), 'utf8');

  const queuePath = path.join(root, 'AI_MEMORY', 'hardening-queue.json');
  fs.writeFileSync(queuePath, JSON.stringify({
    items: [{
      id: 'P1-A1', title: 'a1', status: 'ready_for_approval', state: estado,
      severity: 'P1', regressionTest: 'tests/unit/regressao.test.js',
    }],
  }, null, 2), 'utf8');

  const prova = proof.construirProvaDeFechamento({
    defectId: 'P1-A1',
    severityBefore: 'P1',
    severityAfter: 'P1',
    fromState: estado,
    toState,
    evaluatedCommit: SHA,
    codeFingerprint: FP,
    requiredTests: ['tests/unit/regressao.test.js'],
    executions: [{
      testPath: 'tests/unit/regressao.test.js',
      command: 'npx jest tests/unit/regressao.test.js',
      exitCode: 0,
      startedAt: '2026-10-22T10:00:00.000Z',
      finishedAt: '2026-10-22T10:00:05.000Z',
      outputPath: 'prova-saida/regressao.log',
      outputSha256: outHash,
    }],
    artifactHashes: [{ path: 'tests/unit/regressao.test.js', sha256: testHash }],
    actor: { id: 'owner@example.invalid', kind: 'humano' },
    policyDecision: { decision: 'CLOSE_VERIFIED', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
  });
  const payload = {};
  for (const campo of proof.CAMPOS_ASSINADOS) payload[campo] = prova[campo];
  prova.signature = {
    alg: 'Ed25519',
    keyId: 'owner@example.invalid',
    value: crypto.sign(null, Buffer.from(sig.canonicalJson(payload), 'utf8'), privateKey).toString('base64'),
  };

  return {
    root, queuePath, prova, privateKey,
    ancoragem: { pins: [fingerprint], externa: fingerprint },
  };
}

function aplicar(c) {
  return service.applyTransition({
    rootDir: c.root,
    queuePath: c.queuePath,
    defectId: 'P1-A1',
    to: 'VERIFIED',
    proof: c.prova,
    actor: { id: 'owner@example.invalid' },
    currentCommit: SHA,
    currentFingerprint: FP,
    ancoragem: c.ancoragem,
    agora: Date.parse(c.prova.createdAt) + 1000,
  });
}

// ─── A1 ─────────────────────────────────────────────────────────────────────

describe('A1 — transição legítima NÃO pode invalidar a própria prova após persistir', () => {
  test('após applyTransition, recarregar inventário mantém o item PROVADO', () => {
    const c = cenario();
    const r = aplicar(c);
    expect(r.ok).toBe(true);

    // Recarrega do DISCO (o que o gate faz de verdade), com livro real.
    const inv = registry.carregarInventario({
      queuePath: c.queuePath, rootDir: c.root, currentCommit: SHA, currentFingerprint: FP,
      ancoragem: c.ancoragem,
    });
    const item = inv.defeitos[0];
    expect(item.state).toBe('VERIFIED');
    expect(item.fechamentoNaoProvado).toBe(false);
    expect(item.provaDeFechamento && item.provaDeFechamento.code).toBeFalsy();
    expect(item.stateEfetivo).toBe('VERIFIED');
  });

  test('elegibilidade não acusa FECHAMENTO_SEM_PROVA_VALIDA para a prova já aplicada', () => {
    const c = cenario();
    expect(aplicar(c).ok).toBe(true);
    const inv = registry.carregarInventario({
      queuePath: c.queuePath, rootDir: c.root, currentCommit: SHA, currentFingerprint: FP,
      ancoragem: c.ancoragem,
    });
    const decisao = eligibility.evaluateExecutionEligibility(
      { commit: SHA, actor: { id: 'cli', kind: 'script' }, defects: inv.defeitos },
      'SELO_FINAL',
    );
    expect(decisao.reasonCodes).not.toContain('FECHAMENTO_SEM_PROVA_VALIDA');
  });

  test('prova PENDENTE (estado ainda é o `from`) continua válida', () => {
    const c = cenario();
    // Sem aplicar: o estado persistido é o `fromState` da prova.
    const veredito = proof.verificarProvaDeFechamento(c.prova, {
      defeito: { id: 'P1-A1', severity: 'P1', state: 'FIXED_PENDING_VERIFICATION' },
      currentCommit: SHA, currentFingerprint: FP, rootDir: c.root, livro: null,
      ancoragem: c.ancoragem, agora: Date.parse(c.prova.createdAt) + 1000,
      existeArquivo: (rel) => fs.existsSync(path.join(c.root, rel)),
    });
    expect(veredito.reasons).not.toContain('ESTADO_DE_ORIGEM_DIVERGENTE');
  });

  test('estado persistido ESTRANHO (nem `from` nem `to`) continua recusado', () => {
    const c = cenario();
    const veredito = proof.verificarProvaDeFechamento(c.prova, {
      defeito: { id: 'P1-A1', severity: 'P1', state: 'OPEN' },
      currentCommit: SHA, currentFingerprint: FP, rootDir: c.root, livro: null,
      ancoragem: c.ancoragem, agora: Date.parse(c.prova.createdAt) + 1000,
      existeArquivo: (rel) => fs.existsSync(path.join(c.root, rel)),
    });
    expect(veredito.reasons).toContain('ESTADO_DE_ORIGEM_DIVERGENTE');
  });
});

// ─── A2 ─────────────────────────────────────────────────────────────────────

describe('A2 — o evento do livro tem de ser IGUAL à prova, não apenas existir', () => {
  /** Aplica a transição e devolve o livro carregado do disco. */
  function comLivro() {
    const c = cenario();
    expect(aplicar(c).ok).toBe(true);
    const livro = ledger.verificarLivro(c.root);
    return { c, livro, evento: livro.eventos[0] };
  }

  const ctxCom = (c, livro) => ({
    defeito: { id: 'P1-A1', severity: 'P1', state: 'VERIFIED' },
    currentCommit: SHA,
    currentFingerprint: FP,
    rootDir: c.root,
    livro,
    ancoragem: c.ancoragem,
    agora: Date.parse(c.prova.createdAt) + 1000,
    existeArquivo: (rel) => fs.existsSync(path.join(c.root, rel)),
  });

  test('linha de base: prova aplicada e livro coerente passam', () => {
    const { c, livro } = comLivro();
    const v = proof.verificarProvaDeFechamento(c.prova, ctxCom(c, livro));
    expect(v.reasons).toEqual([]);
  });

  test.each([
    ['from', (e) => { e.from = 'OPEN'; }],
    ['to', (e) => { e.to = 'RESOLVED'; }],
    ['proofHash', (e) => { e.proofHash = 'f'.repeat(64); }],
    ['actorId', (e) => { e.actorId = 'outro@example.invalid'; }],
    ['evaluatedCommit', (e) => { e.evaluatedCommit = 'c'.repeat(40); }],
    ['kind', (e) => { e.kind = 'ATTESTATION'; }],
    ['defectId', (e) => { e.defectId = 'P1-OUTRO'; }],
  ])('evento com `%s` divergente da prova é RECUSADO', (_campo, adulterar) => {
    const { c, livro, evento } = comLivro();
    adulterar(evento);
    const v = proof.verificarProvaDeFechamento(c.prova, ctxCom(c, livro));
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('EVENTO_DIVERGENTE_DA_PROVA');
  });

  test('transitionId trocado no evento ⇒ não é a prova registrada', () => {
    const { c, livro, evento } = comLivro();
    evento.transitionId = crypto.randomUUID();
    const v = proof.verificarProvaDeFechamento(c.prova, ctxCom(c, livro));
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('TRANSICAO_NAO_REGISTRADA');
  });
});

// ─── A3 ─────────────────────────────────────────────────────────────────────

describe('A3 — atestação recusada NÃO pode deixar evento órfão no livro', () => {
  test('proofsPath fora da raiz ⇒ recusa ANTES de anexar ao livro', () => {
    const c = cenario({ estado: 'RESOLVED', toState: 'RESOLVED' });
    const provaAtest = reAssinarAtestacao(c);
    const caminhoLivro = path.join(c.root, ledger.REL_PADRAO);
    const livroAntes = fs.existsSync(caminhoLivro) ? fs.readFileSync(caminhoLivro, 'utf8') : null;

    const r = service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-A1', proof: provaAtest,
      proofsPath: '/tmp',
      actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(provaAtest.createdAt) + 1000,
    });

    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('CAMINHO_DE_PROVA_INVALIDO');
    const livroDepois = fs.existsSync(caminhoLivro) ? fs.readFileSync(caminhoLivro, 'utf8') : null;
    expect(livroDepois).toBe(livroAntes);

    const item = JSON.parse(fs.readFileSync(c.queuePath, 'utf8')).items[0];
    expect(item.state).toBe('RESOLVED');
    expect(item.attestationId).toBeUndefined();

    // O transitionId não foi consumido: a mesma prova pode ser reaplicada com caminho válido.
    const segunda = service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-A1', proof: provaAtest,
      actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(provaAtest.createdAt) + 1000,
    });
    expect(segunda.ok).toBe(true);
  });

  test('atestação válida grava prova, evento ATTESTATION e não muda o estado', () => {
    const c = cenario({ estado: 'RESOLVED', toState: 'RESOLVED' });
    const provaAtest = reAssinarAtestacao(c);
    const r = service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-A1', proof: provaAtest,
      actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(provaAtest.createdAt) + 1000,
    });
    expect(r.ok).toBe(true);
    const item = JSON.parse(fs.readFileSync(c.queuePath, 'utf8')).items[0];
    expect(item.state).toBe('RESOLVED');
    expect(item.attestationId).toBe(provaAtest.transitionId);
    const livro = ledger.verificarLivro(c.root);
    expect(livro.integridadeOk).toBe(true);
    expect(livro.eventos[0].kind).toBe('ATTESTATION');
    expect(livro.eventos[0].from).toBe(livro.eventos[0].to);
  });
});

/** Re-assina a prova do cenário como ATESTAÇÃO (fromState === toState === estado persistido). */
function reAssinarAtestacao(c) {
  const estado = JSON.parse(fs.readFileSync(c.queuePath, 'utf8')).items[0].state;
  const nova = proof.construirProvaDeFechamento({
    defectId: 'P1-A1',
    severityBefore: 'P1',
    severityAfter: 'P1',
    fromState: estado,
    toState: estado,
    evaluatedCommit: SHA,
    codeFingerprint: FP,
    requiredTests: c.prova.requiredTests,
    executions: c.prova.executions,
    artifactHashes: c.prova.artifactHashes,
    actor: c.prova.actor,
    policyDecision: {
      decision: 'REVERIFY_EXISTING_CLOSURE', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0',
    },
  });
  const payload = {};
  for (const campo of proof.CAMPOS_ASSINADOS) payload[campo] = nova[campo];
  nova.signature = {
    alg: 'Ed25519',
    keyId: 'owner@example.invalid',
    value: crypto.sign(null, Buffer.from(sig.canonicalJson(payload), 'utf8'), c.privateKey).toString('base64'),
  };
  return nova;
}
