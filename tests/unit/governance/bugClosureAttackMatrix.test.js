'use strict';

/**
 * FASE C da missão Codex — MATRIZ DE ATAQUES do Bug Closure First.
 *
 * Uma linha por ataque da missão, com o resultado esperado verificado por execução real (não
 * por inspeção de relatório). Casos positivos legítimos ficam no fim: recusar tudo não é
 * segurança, é inoperância.
 *
 * Autoridades e âncoras aqui são de TESTE (chave efêmera, pin local). Nada é promovido à
 * configuração de release.
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

function cenario({ estado = 'FIXED_PENDING_VERIFICATION', severity = 'P1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ataque-'));
  fs.mkdirSync(path.join(root, 'AI_MEMORY'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'unit', 'regressao.test.js'), '// ok\n', 'utf8');
  fs.mkdirSync(path.join(root, 'prova-saida'), { recursive: true });
  fs.writeFileSync(path.join(root, 'prova-saida', 'regressao.log'), 'PASS\n', 'utf8');
  const outHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'prova-saida', 'regressao.log'))).digest('hex');
  const testHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'tests', 'unit', 'regressao.test.js'))).digest('hex');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const fingerprint = TA.fingerprintDaChavePem(pem);
  fs.mkdirSync(path.join(root, 'governance', 'risk-acceptance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance', 'risk-acceptance', 'authorities.json'), JSON.stringify({
    authorities: [{ identity: 'owner@example.invalid', mayCloseDefects: true, mayApproveMissions: true, publicKeyPem: pem }],
  }, null, 2), 'utf8');

  const queuePath = path.join(root, 'AI_MEMORY', 'hardening-queue.json');
  fs.writeFileSync(queuePath, JSON.stringify({
    items: [{ id: 'P1-ATQ', title: 'atq', status: 'ready_for_approval', state: estado, severity, regressionTest: 'tests/unit/regressao.test.js' }],
  }, null, 2), 'utf8');

  const base = {
    defectId: 'P1-ATQ',
    severityBefore: severity,
    severityAfter: severity,
    fromState: estado,
    toState: 'VERIFIED',
    evaluatedCommit: SHA,
    codeFingerprint: FP,
    requiredTests: ['tests/unit/regressao.test.js'],
    executions: [{
      testPath: 'tests/unit/regressao.test.js', command: 'npx jest x', exitCode: 0,
      startedAt: '2026-10-22T10:00:00.000Z', finishedAt: '2026-10-22T10:00:05.000Z',
      outputPath: 'prova-saida/regressao.log', outputSha256: outHash,
    }],
    artifactHashes: [{ path: 'tests/unit/regressao.test.js', sha256: testHash }],
    actor: { id: 'owner@example.invalid', kind: 'humano' },
    policyDecision: { decision: 'CLOSE_VERIFIED', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
  };

  const assinar = (entrada) => {
    const p = proof.construirProvaDeFechamento(entrada);
    const payload = {};
    for (const campo of proof.CAMPOS_ASSINADOS) payload[campo] = p[campo];
    p.signature = {
      alg: 'Ed25519', keyId: 'owner@example.invalid',
      value: crypto.sign(null, Buffer.from(sig.canonicalJson(payload), 'utf8'), privateKey).toString('base64'),
    };
    return p;
  };

  return { root, queuePath, base, assinar, privateKey, ancoragem: { pins: [fingerprint], externa: fingerprint } };
}

/** Verifica a prova contra o cenário; devolve motivos. */
function verificar(c, prova, over = {}) {
  return proof.verificarProvaDeFechamento(prova, {
    defeito: { id: 'P1-ATQ', severity: over.severity || 'P1', state: over.state || 'FIXED_PENDING_VERIFICATION' },
    currentCommit: over.currentCommit || SHA,
    currentFingerprint: over.currentFingerprint || FP,
    rootDir: c.root,
    livro: over.livro === undefined ? null : over.livro,
    ancoragem: over.ancoragem || c.ancoragem,
    agora: over.agora || Date.parse(prova.createdAt) + 1000,
    existeArquivo: (rel) => fs.existsSync(path.join(c.root, rel)),
  });
}

// ─── Ataques de inventário / elegibilidade ─────────────────────────────────

describe('FASE C — inventário e elegibilidade', () => {
  function avaliar(defeitos, operacao = 'SELO_FINAL', commit = SHA) {
    return eligibility.evaluateExecutionEligibility(
      { commit, actor: { id: 'cli', kind: 'script' }, defects: defeitos },
      operacao,
    );
  }

  test.each([
    ['state direto para VERIFIED', [{ id: 'P1-X', severity: 'P1', state: 'VERIFIED' }]],
    ['status legado prevention_active', [{ id: 'P1-X', severity: 'P1', status: 'prevention_active' }]],
    ['inventário vazio', []],
  ])('%s ⇒ DENIED', (_nome, defeitos) => {
    expect(avaliar(defeitos).allowed).toBe(false);
  });

  test('remover todos os P0/P1 (inventário só com P3 fechado) não libera selo sem âncora', () => {
    const d = avaliar([{ id: 'P3-X', severity: 'P3', state: 'RESOLVED' }]);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain('INVENTARIO_NAO_ANCORADO');
  });

  test('inventário de outro arquivo via opção não casa com a âncora externa', () => {
    const outro = fs.mkdtempSync(path.join(os.tmpdir(), 'outro-'));
    const q = path.join(outro, 'q.json');
    fs.writeFileSync(q, JSON.stringify({ items: [] }), 'utf8');
    const inv = registry.carregarInventario({ queuePath: q, currentCommit: SHA });
    const d = avaliar(inv.defeitos);
    expect(d.allowed).toBe(false);
  });
});

// ─── Ataques à prova ───────────────────────────────────────────────────────

describe('FASE C — prova e execução', () => {
  const casos = [
    ['sem regressão executada', (b) => ({ ...b, executions: [] }), 'TESTE_NAO_EXECUTADO'],
    ['exitCode null', (b) => ({ ...b, executions: [{ ...b.executions[0], exitCode: null }] }), 'EXIT_CODE_AUSENTE'],
    ['exitCode 1', (b) => ({ ...b, executions: [{ ...b.executions[0], exitCode: 1 }] }), 'EXIT_CODE_NAO_ZERO'],
    ['timeout', (b) => ({ ...b, executions: [{ ...b.executions[0], timeout: true }] }), 'TIMEOUT_NO_TESTE'],
    ['output hash divergente', (b) => ({ ...b, executions: [{ ...b.executions[0], outputSha256: 'f'.repeat(64) }] }), 'EVIDENCIA_ADULTERADA'],
    ['sem outputPath (atestação sem artefato)', (b) => ({ ...b, executions: [{ ...b.executions[0], outputPath: undefined }] }), 'EVIDENCIA_ADULTERADA'],
    ['severidade rebaixada P1→P3', (b) => ({ ...b, severityBefore: 'P3', severityAfter: 'P3' }), 'SEVERIDADE_DIVERGENTE'],
  ];

  test.each(casos)('%s ⇒ recusado', (_nome, mutar, codigo) => {
    const c = cenario();
    const v = verificar(c, c.assinar(mutar(c.base)));
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain(codigo);
  });

  test('SHA avaliado de outro commit ⇒ recusado', () => {
    const c = cenario();
    const v = verificar(c, c.assinar(c.base), { currentCommit: 'c'.repeat(40) });
    expect(v.reasons).toEqual(expect.arrayContaining(['COMMIT_NAO_ANCESTRAL']));
  });

  test('source fingerprint alterado ⇒ recusado', () => {
    const c = cenario();
    const v = verificar(c, c.assinar(c.base), { currentFingerprint: 'e'.repeat(64) });
    expect(v.reasons).toContain('FINGERPRINT_DIVERGENTE');
  });

  test('assinatura com chave NÃO autorizada ⇒ recusada', () => {
    const c = cenario();
    const p = c.assinar(c.base);
    const outra = crypto.generateKeyPairSync('ed25519');
    const payload = {};
    for (const campo of proof.CAMPOS_ASSINADOS) payload[campo] = p[campo];
    p.signature.value = crypto.sign(null, Buffer.from(sig.canonicalJson(payload), 'utf8'), outra.privateKey).toString('base64');
    const v = verificar(c, p);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('ASSINATURA_INVALIDA');
  });

  test('chave correta mas SEM âncora externa ⇒ recusada', () => {
    const c = cenario();
    const v = verificar(c, c.assinar(c.base), { ancoragem: { pins: c.ancoragem.pins, externa: null } });
    expect(v.reasons).toContain('SEM_ANCORA_DE_CONFIANCA');
  });

  test('MANIPULAÇÃO DE RELÓGIO: prova vencida ⇒ recusada', () => {
    const c = cenario();
    const p = c.assinar(c.base);
    const v = verificar(c, p, { agora: Date.parse(p.createdAt) + 90 * 24 * 3600 * 1000 });
    expect(v.reasons).toContain('PROVA_VENCIDA');
  });

  test('MANIPULAÇÃO DE RELÓGIO: prova do futuro ⇒ recusada', () => {
    const c = cenario();
    const p = c.assinar(c.base);
    const v = verificar(c, p, { agora: Date.parse(p.createdAt) - 3600 * 1000 });
    expect(v.reasons).toContain('PROVA_VENCIDA');
  });
});

// ─── Ataques ao livro ──────────────────────────────────────────────────────

describe('FASE C — livro e eventos', () => {
  test('evento de OUTRO defeito reutilizado ⇒ recusado', () => {
    const c = cenario();
    const p = c.assinar(c.base);
    ledger.anexarEvento({
      rootDir: c.root, transitionId: p.transitionId, defectId: 'P1-OUTRO',
      from: 'FIXED_PENDING_VERIFICATION', to: 'VERIFIED', kind: 'TRANSITION',
      actorId: 'owner@example.invalid', proofHash: proof.hashDoPayload(p), evaluatedCommit: SHA,
    });
    const v = verificar(c, p, { livro: ledger.verificarLivro(c.root) });
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('REPLAY_DE_EVENTO');
  });

  test('transitionId reutilizado (replay) ⇒ o append é recusado', () => {
    const c = cenario();
    const p = c.assinar(c.base);
    const ev = {
      rootDir: c.root, transitionId: p.transitionId, defectId: 'P1-ATQ',
      from: 'FIXED_PENDING_VERIFICATION', to: 'VERIFIED', kind: 'TRANSITION',
      actorId: 'owner@example.invalid', proofHash: proof.hashDoPayload(p), evaluatedCommit: SHA,
    };
    expect(ledger.anexarEvento(ev).ok).toBe(true);
    const segundo = ledger.anexarEvento(ev);
    expect(segundo.ok).toBe(false);
    expect(segundo.code).toBe('TRANSICAO_ID_DUPLICADO');
  });

  test('livro internamente CONSISTENTE mas com proofHash de outra prova ⇒ recusado', () => {
    const c = cenario();
    const p = c.assinar(c.base);
    ledger.anexarEvento({
      rootDir: c.root, transitionId: p.transitionId, defectId: 'P1-ATQ',
      from: 'FIXED_PENDING_VERIFICATION', to: 'VERIFIED', kind: 'TRANSITION',
      actorId: 'owner@example.invalid', proofHash: 'a'.repeat(64), evaluatedCommit: SHA,
    });
    const livro = ledger.verificarLivro(c.root);
    expect(livro.integridadeOk).toBe(true); // cadeia de hash íntegra…
    const v = verificar(c, p, { livro });
    expect(v.ok).toBe(false); // …e ainda assim a prova é recusada
    expect(v.reasons).toContain('EVENTO_DIVERGENTE_DA_PROVA');
  });
});

// ─── Ataques de caminho e de atestação ────────────────────────────────────

describe('FASE C — caminho de prova e atestação', () => {
  test('transitionId com traversal ⇒ recusado sem mutação', () => {
    const c = cenario();
    const p = c.assinar({ ...c.base, transitionId: '../../governance/x' });
    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-ATQ', to: 'VERIFIED', proof: p,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
      ancoragem: c.ancoragem,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('TRANSITION_ID_INVALIDO');
    expect(JSON.parse(fs.readFileSync(c.queuePath, 'utf8')).items[0].state).toBe('FIXED_PENDING_VERIFICATION');
  });

  test('SYMLINK ESCAPE: diretório de provas apontando para fora ⇒ recusado', () => {
    const c = cenario();
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'fora-'));
    const dirProvas = path.join(c.root, 'governance', 'bug-closure');
    fs.mkdirSync(dirProvas, { recursive: true });
    fs.symlinkSync(fora, path.join(dirProvas, 'proofs'), 'dir');

    const p = c.assinar(c.base);
    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-ATQ', to: 'VERIFIED', proof: p,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
      ancoragem: c.ancoragem, agora: Date.parse(p.createdAt) + 1000,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('CAMINHO_DE_PROVA_INVALIDO');
    // Nada foi escrito fora da raiz.
    expect(fs.readdirSync(fora)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(c.queuePath, 'utf8')).items[0].state).toBe('FIXED_PENDING_VERIFICATION');
  });

  test('atestar defeito OPEN ⇒ recusado', () => {
    const c = cenario({ estado: 'OPEN' });
    const p = c.assinar({
      ...c.base, fromState: 'OPEN', toState: 'OPEN',
      policyDecision: { decision: 'REVERIFY_EXISTING_CLOSURE', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
    });
    const r = service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-ATQ', proof: p,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('ATESTACAO_SO_EM_ESTADO_DE_FECHAMENTO');
  });

  test('atestar defeito RISK_ACCEPTED ⇒ recusado', () => {
    const c = cenario({ estado: 'RISK_ACCEPTED' });
    const p = c.assinar({
      ...c.base, fromState: 'RISK_ACCEPTED', toState: 'RISK_ACCEPTED',
      policyDecision: { decision: 'REVERIFY_EXISTING_CLOSURE', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
    });
    const r = service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-ATQ', proof: p,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
    });
    expect(r.ok).toBe(false);
  });

  test('atestação SEM teste executado ⇒ recusada', () => {
    const c = cenario({ estado: 'RESOLVED' });
    const p = c.assinar({
      ...c.base, fromState: 'RESOLVED', toState: 'RESOLVED', executions: [],
      policyDecision: { decision: 'REVERIFY_EXISTING_CLOSURE', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
    });
    const r = service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-ATQ', proof: p,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('TESTE_NAO_EXECUTADO');
  });
});

// ─── Casos POSITIVOS legítimos ────────────────────────────────────────────

describe('FASE C — casos positivos (recusar tudo não é segurança)', () => {
  test('transição legítima aplica e fica verificável após persistir', () => {
    const c = cenario();
    const p = c.assinar(c.base);
    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-ATQ', to: 'VERIFIED', proof: p,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
      ancoragem: c.ancoragem, agora: Date.parse(p.createdAt) + 1000,
    });
    expect(r.ok).toBe(true);
    const v = verificar(c, p, { state: 'VERIFIED', livro: ledger.verificarLivro(c.root) });
    expect(v.reasons).toEqual([]);
  });

  test('atestação legítima passa e não muda o estado', () => {
    const c = cenario({ estado: 'RESOLVED' });
    const p = c.assinar({
      ...c.base, fromState: 'RESOLVED', toState: 'RESOLVED',
      policyDecision: { decision: 'REVERIFY_EXISTING_CLOSURE', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
    });
    const r = service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'P1-ATQ', proof: p,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
      ancoragem: c.ancoragem, agora: Date.parse(p.createdAt) + 1000,
    });
    expect(r.ok).toBe(true);
    const item = JSON.parse(fs.readFileSync(c.queuePath, 'utf8')).items[0];
    expect(item.state).toBe('RESOLVED');
    expect(item.attestationId).toBe(p.transitionId);
  });

  test('operação NÃO certificante continua permitida com P0 aberto', () => {
    const d = eligibility.evaluateExecutionEligibility(
      { commit: SHA, actor: { id: 'cli', kind: 'script' }, defects: [{ id: 'P0-X', severity: 'P0', state: 'OPEN' }] },
      'TESTES_DIRECIONADOS',
    );
    expect(d.allowed).toBe(true);
  });
});
