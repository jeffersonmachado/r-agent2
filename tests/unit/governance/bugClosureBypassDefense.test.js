'use strict';

/**
 * MISSÃO P0 (2026-10-22) — BLINDAGEM DO BUG CLOSURE FIRST.
 *
 * DEFEITO REAL reproduzido na baseline `002363424` e nos commits anteriores: o gate
 * central decidia bloqueio pelo campo PERSISTIDO `state` da fila. Editar
 * `AI_MEMORY/hardening-queue.json` para `state: "RESOLVED"` (ou apenas
 * `status: "prevention_active"`, que a migração legada traduz para RESOLVED) fazia
 * `evaluateExecutionEligibility(..., 'SELO_FINAL')` devolver `ALLOWED` — sem executar
 * um único teste, sem verificar o SHA e sem prova nenhuma.
 *
 * Este arquivo contém a MATRIZ ADVERSARIAL obrigatória da missão (§9). Ele roda os
 * MESMOS ataques contra DOIS códigos:
 *
 *   - BASELINE, materializada a partir do commit `002363424` via `git show` (prova de que
 *     o ataque funcionava antes da correção — teste vermelho por construção);
 *   - ATUAL, os módulos do worktree (prova de que os ataques são recusados).
 *
 * Nenhum teste aqui "confia no relatório": o que se verifica é a DECISÃO de autorização
 * (`allowed`/`decision`) e, quando aplicável, que a fila NÃO foi alterada.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const BASELINE_COMMIT = '0023634244ad05b3e2a01a61987a244c30ea75b2';
const SHA = 'a'.repeat(40);
const FP = 'b'.repeat(64);

const ATUAL = {
  registry: require('../../../governance/bug-closure/defect-registry'),
  eligibility: require('../../../governance/bug-closure/eligibility'),
  proof: require('../../../governance/bug-closure/closure-proof'),
  ledger: require('../../../governance/bug-closure/transition-ledger'),
  service: require('../../../governance/bug-closure/transition-service'),
  consistency: require('../../../governance/bug-closure/authority-consistency'),
  signature: require('../../../governance/risk-acceptance/signature'),
};

/** Materializa os módulos da BASELINE em um diretório temporário e os carrega. */
function carregarBaseline() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-baseline-'));
  const destino = path.join(dir, 'governance', 'bug-closure');
  fs.mkdirSync(destino, { recursive: true });
  for (const arquivo of ['defect-states.js', 'defect-registry.js', 'eligibility.js']) {
    const fonte = execFileSync('git', ['show', `${BASELINE_COMMIT}:governance/bug-closure/${arquivo}`], {
      cwd: RAIZ, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(destino, arquivo), fonte, 'utf8');
  }
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return {
    dir,
    registry: require(path.join(destino, 'defect-registry.js')),
    eligibility: require(path.join(destino, 'eligibility.js')),
  };
}

let baseline = null;
let raizBaseline = null;

beforeAll(() => {
  baseline = carregarBaseline();
  raizBaseline = baseline.dir;
});

afterAll(() => {
  if (raizBaseline) fs.rmSync(raizBaseline, { recursive: true, force: true });
});

// ─── helpers de cenário ─────────────────────────────────────────────────────

const CHAVES = new Map();

function novaRaiz({ comAutoridade = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-cenario-'));
  fs.mkdirSync(path.join(root, 'AI_MEMORY'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'unit', 'regressao.test.js'), '// regressao real\n', 'utf8');
  fs.mkdirSync(path.join(root, 'governance', 'risk-acceptance'), { recursive: true });
  const autoridades = [];
  if (comAutoridade) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    CHAVES.set(root, privateKey);
    autoridades.push({
      identity: 'owner@example.invalid',
      authority: 'PLATFORM_OWNER',
      mayCloseDefects: true,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    });
  }
  fs.writeFileSync(
    path.join(root, 'governance', 'risk-acceptance', 'authorities.json'),
    JSON.stringify({ authorities: autoridades }, null, 2),
    'utf8',
  );
  return root;
}

const filaCom = (itens) => ({ items: itens });

function escreverFila(root, itens) {
  const p = path.join(root, 'AI_MEMORY', 'hardening-queue.json');
  fs.writeFileSync(p, JSON.stringify(filaCom(itens), null, 2), 'utf8');
  return p;
}

const itemBase = (extra = {}) => ({
  id: 'P1-ADVERSARIAL',
  title: 'defeito P1 de teste',
  status: 'in_progress',
  state: 'FIX_IN_PROGRESS',
  severity: 'P1',
  regressionTest: 'tests/unit/regressao.test.js',
  ...extra,
});

/** Avalia com o código ATUAL. */
function avaliarAtual(root, operacao = 'SELO_FINAL', opcoes = {}) {
  const inv = ATUAL.registry.carregarInventario({
    queuePath: path.join(root, 'AI_MEMORY', 'hardening-queue.json'),
    rootDir: root,
    currentCommit: opcoes.currentCommit || SHA,
    currentFingerprint: opcoes.currentFingerprint || FP,
    livro: opcoes.livro,
    livroPath: opcoes.livroPath,
    agora: opcoes.agora,
  });
  return ATUAL.eligibility.evaluateExecutionEligibility(
    { commit: SHA, actor: { id: 'teste', kind: 'script' }, defects: inv.defeitos },
    operacao,
  );
}

/** Avalia com o código da BASELINE (prova de que o ataque funcionava). */
function avaliarBaseline(root, operacao = 'SELO_FINAL') {
  const inv = baseline.registry.carregarInventario({
    queuePath: path.join(root, 'AI_MEMORY', 'hardening-queue.json'),
  });
  return baseline.eligibility.evaluateExecutionEligibility(
    { commit: SHA, actor: { id: 'teste', kind: 'script' }, defects: inv.defeitos },
    operacao,
  );
}

/** Prova de fechamento bem formada e ASSINADA por autoridade de teste. */
function provaValida(root, overrides = {}) {
  const privada = CHAVES.get(root) || crypto.generateKeyPairSync('ed25519').privateKey;
  const chave = { privateKey: privada };
  const shaArquivo = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'tests', 'unit', 'regressao.test.js')))
    .digest('hex');

  const prova = ATUAL.proof.construirProvaDeFechamento({
    defectId: 'P1-ADVERSARIAL',
    severityBefore: 'P1',
    severityAfter: 'P1',
    fromState: 'FIXED_PENDING_VERIFICATION',
    toState: 'VERIFIED',
    evaluatedCommit: SHA,
    codeFingerprint: FP,
    requiredTests: ['tests/unit/regressao.test.js'],
    executions: [{
      testPath: 'tests/unit/regressao.test.js',
      command: 'npx jest tests/unit/regressao.test.js',
      exitCode: 0,
      startedAt: '2026-10-22T10:00:00.000Z',
      finishedAt: '2026-10-22T10:00:05.000Z',
      outputSha256: 'c'.repeat(64),
    }],
    artifactHashes: [{ path: 'tests/unit/regressao.test.js', sha256: shaArquivo }],
    actor: { id: 'owner@example.invalid', kind: 'humano' },
    policyDecision: { decision: 'CLOSE_VERIFIED', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
    ...overrides,
  });
  const payload = {};
  for (const campo of ATUAL.proof.CAMPOS_ASSINADOS) payload[campo] = prova[campo];
  prova.signature = {
    alg: 'Ed25519',
    keyId: 'owner@example.invalid',
    value: crypto.sign(null, Buffer.from(ATUAL.signature.canonicalJson(payload), 'utf8'), chave.privateKey).toString('base64'),
  };
  return { prova };
}

// ─── 1. PROVA DE QUE O BYPASS EXISTIA (baseline) ────────────────────────────

describe('BASELINE 002363424 — o bypass por edição de JSON era real', () => {
  test('P1 OPEN ⇒ DENIED (comportamento correto já existente)', () => {
    const root = novaRaiz();
    escreverFila(root, [itemBase({ state: 'OPEN', status: 'pending' })]);
    expect(avaliarBaseline(root).decision).toBe('DENIED');
  });

  test('editar state=RESOLVED e status=prevention_active ⇒ ALLOWED (BYPASS)', () => {
    const root = novaRaiz();
    escreverFila(root, [itemBase({ state: 'RESOLVED', status: 'prevention_active' })]);
    expect(avaliarBaseline(root).allowed).toBe(true);
  });

  test('editar SÓ o status legado (sem state) ⇒ ALLOWED (BYPASS)', () => {
    const root = novaRaiz();
    const item = itemBase({ status: 'prevention_active' });
    delete item.state;
    escreverFila(root, [item]);
    expect(avaliarBaseline(root).allowed).toBe(true);
  });
});

// ─── 2. MATRIZ ADVERSARIAL OBRIGATÓRIA (§9) ────────────────────────────────

describe('MATRIZ ADVERSARIAL — ataques de JSON nunca autorizam certificação', () => {
  const ataques = [
    ['1. P1 OPEN sem evidência', () => [itemBase({ state: 'OPEN', status: 'pending', evidence: null })]],
    ['2. alterar diretamente para RESOLVED', () => [itemBase({ state: 'RESOLVED', status: 'prevention_active' })]],
    ['3. alterar diretamente para VERIFIED', () => [itemBase({ state: 'VERIFIED', status: 'verified' })]],
    ['4. alterar somente status legado', () => { const i = itemBase({ status: 'prevention_active' }); delete i.state; return [i]; }],
    ['5. alterar state e status simultaneamente', () => [itemBase({ state: 'VERIFIED', status: 'verified', evidence: 'afirmacao' })]],
    ['10. estado desconhecido', () => [itemBase({ state: 'TALVEZ', status: 'done' })]],
    ['11. severidade desconhecida', () => [itemBase({ state: 'OPEN', severity: 'P9' })]],
    ['12. BLOCKED_EXTERNAL → RESOLVED direta', () => [itemBase({ state: 'RESOLVED', status: 'prevention_active', blocked_reason: 'x' })]],
  ];

  test.each(ataques)('%s ⇒ DENIED no código corrigido', (_nome, montar) => {
    const root = novaRaiz();
    escreverFila(root, montar());
    const decisao = avaliarAtual(root);
    expect(decisao.allowed).toBe(false);
    expect(decisao.decision).toBe('DENIED');
  });

  test('6. remover defeito BLOQUEADO do roteamento L1 ⇒ violação de consistência', () => {
    const root = novaRaiz();
    escreverFila(root, [itemBase({ state: 'BLOCKED_EXTERNAL', status: 'blocked_external', blocked_reason: 'x' })]);
    const inv = ATUAL.registry.carregarInventario({
      queuePath: path.join(root, 'AI_MEMORY', 'hardening-queue.json'), rootDir: root, currentCommit: SHA, currentFingerprint: FP, livro: null,
    });
    const r = ATUAL.consistency.verificarConsistenciaDeRoteamento({ defeitos: inv.defeitos, roteamento: { items: {} } });
    expect(r.ok).toBe(false);
    expect(r.violations[0].code).toBe('ROTEAMENTO_CONTRADIZ_AUTORIDADE');
  });

  test('7. apagar P1 do inventário depois de registrar fechamento ⇒ INVENTARIO_INCOMPLETO', () => {
    const rodada = ATUAL.consistency.verificarCompletudeDoInventario({
      defeitos: [],
      livro: { integridadeOk: true, eventos: [{ defectId: 'P1-APAGADO' }] },
    });
    expect(rodada.ok).toBe(false);
    expect(rodada.violations[0].code).toBe('INVENTARIO_INCOMPLETO');
  });

  test('8/9. inventário ausente e malformado ⇒ fail-closed (erro nomeado)', () => {
    const root = novaRaiz();
    expect(() => ATUAL.registry.carregarInventario({ queuePath: path.join(root, 'nao-existe.json') }))
      .toThrow(/FILA_AUSENTE/);
    fs.writeFileSync(path.join(root, 'quebrada.json'), '{ "items": ', 'utf8');
    expect(() => ATUAL.registry.carregarInventario({ queuePath: path.join(root, 'quebrada.json') }))
      .toThrow(/FILA_ILEGIVEL/);
  });
});

// ─── 3. PROVA DE FECHAMENTO: CADA CAMPO É OBRIGATÓRIO ──────────────────────

describe('PROVA DE FECHAMENTO — recusa é nomeada, nunca silenciosa', () => {
  const ctx = (root, prova) => ({
    defeito: { id: 'P1-ADVERSARIAL', severity: 'P1', state: 'FIXED_PENDING_VERIFICATION' },
    currentCommit: SHA,
    currentFingerprint: FP,
    rootDir: root,
    autoridades: undefined,
    livro: null,
    agora: Date.parse('2026-10-22T10:00:10.000Z'),
  });

  const cenarios = [
    ['13. transição válida sem regressão', { requiredTests: [], executions: [] }, 'REGRESSAO_AUSENTE'],
    ['14. regressão com exit code 1', { executions: [{ testPath: 'tests/unit/regressao.test.js', command: 'x', exitCode: 1, startedAt: 'a', finishedAt: 'b', outputSha256: 'c'.repeat(64) }] }, 'EXIT_CODE_NAO_ZERO'],
    ['15. regressão com exit code null', { executions: [{ testPath: 'tests/unit/regressao.test.js', command: 'x', exitCode: null, startedAt: 'a', finishedAt: 'b', outputSha256: 'c'.repeat(64) }] }, 'EXIT_CODE_AUSENTE'],
    ['16. timeout durante teste', { executions: [{ testPath: 'tests/unit/regressao.test.js', command: 'x', exitCode: 0, timeout: true, startedAt: 'a', finishedAt: 'b', outputSha256: 'c'.repeat(64) }] }, 'TIMEOUT_NO_TESTE'],
    ['17. evidência de outro SHA', { evaluatedCommit: 'd'.repeat(40) }, 'SHA_DIVERGENTE'],
    ['18. fingerprint divergente', { codeFingerprint: 'e'.repeat(64) }, 'FINGERPRINT_DIVERGENTE'],
    ['19. hash de artefato adulterado', { artifactHashes: [{ path: 'tests/unit/regressao.test.js', sha256: 'f'.repeat(64) }] }, 'EVIDENCIA_ADULTERADA'],
    ['20. prova de outro defeito', { defectId: 'P1-OUTRO' }, 'DEFEITO_DIVERGENTE'],
    ['24. aprovação humana obrigatória ausente (P0)', { severityBefore: 'P0', severityAfter: 'P0', humanAuthorization: null, negativeEvidence: [{}] }, 'APROVACAO_HUMANA_AUSENTE'],
    ['29. gate de release com prova incompleta (sem testes exigidos declarados)', { requiredTests: [] }, 'REGRESSAO_AUSENTE'],
  ];

  test.each(cenarios)('%s ⇒ recusa %s', (_nome, override, codigo) => {
    const root = novaRaiz({ comAutoridade: true });
    const { prova } = provaValida(root, override);
    const veredito = ATUAL.proof.verificarProvaDeFechamento(prova, ctx(root));
    expect(veredito.ok).toBe(false);
    expect(veredito.reasons).toContain(codigo);
  });

  test('hash da prova não casa com o payload (mutação de campo após assinar)', () => {
    const root = novaRaiz({ comAutoridade: true });
    const { prova } = provaValida(root);
    prova.requiredTests = ['tests/unit/outro.test.js'];
    const veredito = ATUAL.proof.verificarProvaDeFechamento(prova, ctx(root));
    expect(veredito.ok).toBe(false);
    expect(veredito.reasons).toContain('EVIDENCIA_ADULTERADA');
  });

  test('rebaixar severidade (P1 → P3) é recusado', () => {
    const root = novaRaiz({ comAutoridade: true });
    const { prova } = provaValida(root, { severityAfter: 'P3' });
    const veredito = ATUAL.proof.verificarProvaDeFechamento(prova, ctx(root));
    expect(veredito.reasons).toContain('REBAIXAMENTO_DE_SEVERIDADE');
  });
});

// ─── 4. ÂNCORA DE CONFIANÇA (teste de segurança indispensável) ─────────────

describe('ÂNCORA DE CONFIANÇA — atacante com acesso ao inventário E aos hashes locais', () => {
  test('sem autoridade registrada ⇒ SEM_ANCORA_DE_CONFIANCA (certificação fica bloqueada)', () => {
    const root = novaRaiz({ comAutoridade: false });
    escreverFila(root, [itemBase({ state: 'VERIFIED', status: 'verified' })]);
    const decisao = avaliarAtual(root);
    expect(decisao.allowed).toBe(false);
    expect(decisao.reasonCodes).toContain('FECHAMENTO_SEM_PROVA_VALIDA');
  });

  test('prova forjada com chave PRÓPRIA do atacante (não registrada) ⇒ SEM_ANCORA_DE_CONFIANCA', () => {
    const root = novaRaiz({ comAutoridade: true });
    const { prova } = provaValida(root);
    const forjada = crypto.generateKeyPairSync('ed25519');
    const payload = {};
    for (const campo of ATUAL.proof.CAMPOS_ASSINADOS) payload[campo] = prova[campo];
    prova.signature = {
      alg: 'Ed25519',
      keyId: 'owner@example.invalid',
      value: crypto.sign(null, Buffer.from(ATUAL.signature.canonicalJson(payload), 'utf8'), forjada.privateKey).toString('base64'),
    };
    const veredito = ATUAL.proof.verificarProvaDeFechamento(prova, {
      defeito: { id: 'P1-ADVERSARIAL', severity: 'P1', state: 'FIXED_PENDING_VERIFICATION' },
      currentCommit: SHA, currentFingerprint: FP, rootDir: root, livro: null,
      agora: Date.parse('2026-10-22T10:00:10.000Z'),
    });
    expect(veredito.ok).toBe(false);
    expect(veredito.reasons).toContain('ASSINATURA_INVALIDA');
  });

  test('agente não pode ser o ator do fechamento', () => {
    const root = novaRaiz({ comAutoridade: true });
    const { prova } = provaValida(root, { actor: { id: 'copilot-agent', kind: 'agente' } });
    const veredito = ATUAL.proof.verificarProvaDeFechamento(prova, {
      defeito: { id: 'P1-ADVERSARIAL', severity: 'P1', state: 'FIXED_PENDING_VERIFICATION' },
      currentCommit: SHA, currentFingerprint: FP, rootDir: root, livro: null,
      agora: Date.parse('2026-10-22T10:00:10.000Z'),
    });
    expect(veredito.reasons).toContain('ATOR_INVALIDO');
  });
});

// ─── 5. LIVRO DE TRANSIÇÕES: ORDEM, DUPLICAÇÃO, REPLAY ────────────────────

describe('LIVRO APPEND-ONLY', () => {
  test('transição repetida (replay) é recusada', () => {
    const root = novaRaiz();
    const base = { rootDir: root, defectId: 'P1-X', from: 'OPEN', to: 'FIXED_PENDING_VERIFICATION', actorId: 'a', proofHash: null, evaluatedCommit: SHA };
    const primeira = ATUAL.ledger.anexarEvento({ ...base, transitionId: 't-1' });
    expect(primeira.ok).toBe(true);
    const segunda = ATUAL.ledger.anexarEvento({ ...base, transitionId: 't-1' });
    expect(segunda.ok).toBe(false);
    expect(segunda.code).toBe('TRANSICAO_ID_DUPLICADO');
  });

  test('editar uma linha do livro rompe a cadeia', () => {
    const root = novaRaiz();
    ATUAL.ledger.anexarEvento({ rootDir: root, transitionId: 't-1', defectId: 'P1-X', from: 'OPEN', to: 'FIXED_PENDING_VERIFICATION', actorId: 'a', proofHash: null, evaluatedCommit: SHA });
    const arquivo = path.join(root, ATUAL.ledger.REL_PADRAO);
    const linha = JSON.parse(fs.readFileSync(arquivo, 'utf8').trim());
    linha.to = 'VERIFIED';
    fs.writeFileSync(arquivo, `${JSON.stringify(linha)}\n`, 'utf8');
    const estado = ATUAL.ledger.verificarLivro(root);
    expect(estado.integridadeOk).toBe(false);
    expect(estado.problemas.join(',')).toMatch(/CADEIA_ROMPIDA/);
  });

  test('evento fora de ordem é detectado (seq adulterada)', () => {
    const root = novaRaiz();
    ATUAL.ledger.anexarEvento({ rootDir: root, transitionId: 't-1', defectId: 'P1-X', from: 'OPEN', to: 'FIXED_PENDING_VERIFICATION', actorId: 'a', proofHash: null, evaluatedCommit: SHA });
    ATUAL.ledger.anexarEvento({ rootDir: root, transitionId: 't-2', defectId: 'P1-X', from: 'FIXED_PENDING_VERIFICATION', to: 'VERIFIED', actorId: 'a', proofHash: null, evaluatedCommit: SHA });
    const arquivo = path.join(root, ATUAL.ledger.REL_PADRAO);
    const linhas = fs.readFileSync(arquivo, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    fs.writeFileSync(arquivo, `${JSON.stringify(linhas[1])}\n${JSON.stringify(linhas[0])}\n`, 'utf8');
    const estado = ATUAL.ledger.verificarLivro(root);
    expect(estado.integridadeOk).toBe(false);
  });
});

// ─── 6. SERVIÇO DE TRANSIÇÃO: CAMINHO CANÔNICO E CONCORRÊNCIA ─────────────

describe('SERVIÇO DE TRANSIÇÃO', () => {
  function cenarioServico() {
    const root = novaRaiz({ comAutoridade: true });
    const queuePath = escreverFila(root, [itemBase({ state: 'FIXED_PENDING_VERIFICATION', status: 'ready_for_approval' })]);
    const { prova } = provaValida(root);
    return { root, queuePath, prova };
  }

  test('27. transição canônica válida com provas completas ⇒ ALLOW (e fila atualizada)', () => {
    const { root, queuePath, prova } = cenarioServico();
    const r = ATUAL.service.applyTransition({
      rootDir: root, queuePath, defectId: 'P1-ADVERSARIAL', to: 'VERIFIED', proof: prova,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
    });
    expect(r.ok).toBe(true);
    const item = JSON.parse(fs.readFileSync(queuePath, 'utf8')).items[0];
    expect(item.state).toBe('VERIFIED');
    expect(item.closureProof).toMatch(/proofs\//);
  });

  test('21. reutilizar evento de fechamento (mesmo transitionId) ⇒ recusado', () => {
    const { root, queuePath, prova } = cenarioServico();
    const primeira = ATUAL.service.applyTransition({
      rootDir: root, queuePath, defectId: 'P1-ADVERSARIAL', to: 'VERIFIED', proof: prova,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
    });
    expect(primeira.ok).toBe(true);
    escreverFila(root, [itemBase({ state: 'FIXED_PENDING_VERIFICATION', status: 'ready_for_approval' })]);
    const segunda = ATUAL.service.applyTransition({
      rootDir: root, queuePath, defectId: 'P1-ADVERSARIAL', to: 'VERIFIED', proof: prova,
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
    });
    expect(segunda.ok).toBe(false);
  });

  test('23. atualização concorrente com estado obsoleto ⇒ ESTADO_DIVERGENTE', () => {
    const { root, queuePath, prova } = cenarioServico();
    const r = ATUAL.service.applyTransition({
      rootDir: root, queuePath, defectId: 'P1-ADVERSARIAL', to: 'VERIFIED', proof: prova,
      fromExpected: 'FIX_IN_PROGRESS', actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ESTADO_DIVERGENTE');
  });

  test('sem prova ⇒ PROVA_RECUSADA e fila INTACTA (nenhuma operação protegida ocorreu)', () => {
    const { root, queuePath } = cenarioServico();
    const antes = fs.readFileSync(queuePath, 'utf8');
    const r = ATUAL.service.applyTransition({
      rootDir: root, queuePath, defectId: 'P1-ADVERSARIAL', to: 'VERIFIED',
      actor: { id: 'owner@example.invalid' }, currentCommit: SHA, currentFingerprint: FP,
    });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(queuePath, 'utf8')).toBe(antes);
  });
});

// ─── 7. POLÍTICA: DIAGNÓSTICO CONTINUA POSSÍVEL, CERTIFICAÇÃO NÃO ─────────

describe('26/25/30 — política fail-closed sem bloqueio circular', () => {
  test('26. regressão direcionada com P1 aberto ⇒ ALLOW diagnóstico (não certificante)', () => {
    const root = novaRaiz();
    escreverFila(root, [itemBase({ state: 'OPEN', status: 'pending', targetedTestPassing: true })]);
    const decisao = avaliarAtual(root, 'TESTES_DIRECIONADOS');
    expect(decisao.allowed).toBe(true);
  });

  test('L1_AMPLO com falha de fechamento não provado continua autorizado (sem bloqueio circular)', () => {
    const root = novaRaiz();
    // `targetedTestPassing` é o que a política CONDICIONAL exige para P1 aberto: o item
    // histórico tem exatamente esse campo. O que se prova aqui é que o fechamento não
    // provado NÃO adiciona um bloqueio novo (sem ciclo L1 → Bug Closure → selo → L1).
    escreverFila(root, [itemBase({ state: 'RESOLVED', status: 'prevention_active', targetedTestPassing: true })]);
    expect(avaliarAtual(root, 'L1_AMPLO').allowed).toBe(true);
  });

  test('25. P0 aceito administrativamente NÃO libera operação certificante', () => {
    const root = novaRaiz();
    escreverFila(root, [{
      id: 'P0-RISCO', title: 'P0 aceito', status: 'blocked_external', state: 'RISK_ACCEPTED', severity: 'P0',
      riskAcceptedBy: 'owner', riskAcceptedReason: 'pressa', riskAcceptedExpiresAt: '2030-01-01T00:00:00.000Z',
    }]);
    const decisao = avaliarAtual(root);
    expect(decisao.allowed).toBe(false);
  });

  test('30. publicação depois de bypass de JSON ⇒ DENIED', () => {
    const root = novaRaiz();
    escreverFila(root, [itemBase({ state: 'VERIFIED', status: 'verified' })]);
    const decisao = avaliarAtual(root, 'PUBLICACAO_RELEASE');
    expect(decisao.allowed).toBe(false);
    expect(decisao.decision).toBe('DENIED');
  });
});

// ─── 8. CASO HISTÓRICO: L1-NPM-TEST-CI-VERMELHO ───────────────────────────

describe('CASO HISTÓRICO — L1-NPM-TEST-CI-VERMELHO (fechado por edição de JSON)', () => {
  const inventarioReal = () => ATUAL.registry.carregarInventario({
    queuePath: path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json'),
  });

  test('o item declara fechamento SEM prova de fechamento anexada', () => {
    const item = inventarioReal().defeitos.find((d) => d.id === 'L1-NPM-TEST-CI-VERMELHO');
    expect(item).toBeDefined();
    expect(['RESOLVED', 'VERIFIED']).toContain(item.state);
    expect(item.closureProof || null).toBeNull();
  });

  test('o mecanismo corrigido o classifica como fechamento NÃO provado', () => {
    const item = inventarioReal().defeitos.find((d) => d.id === 'L1-NPM-TEST-CI-VERMELHO');
    expect(item.fechamentoNaoProvado).toBe(true);
    expect(item.stateEfetivo).toBe('OPEN');
    expect(item.provaDeFechamento.code).toBe('PROVA_DE_FECHAMENTO_AUSENTE');
  });

  test('SELO_FINAL é NEGADO e o item aparece no achado bloqueante', () => {
    const inv = inventarioReal();
    const decisao = ATUAL.eligibility.evaluateExecutionEligibility(
      { commit: SHA, actor: { id: 'teste', kind: 'script' }, defects: inv.defeitos },
      'SELO_FINAL',
    );
    expect(decisao.allowed).toBe(false);
    const achado = (decisao.blockingFindings || []).find((f) => f.defectId === 'L1-NPM-TEST-CI-VERMELHO');
    expect(achado).toBeDefined();
    expect(achado.code).toBe('FECHAMENTO_SEM_PROVA_VALIDA');
  });

  test('a rota L1_BLOCKING removida NÃO é o que concede autorização (o bloqueio independe do roteamento)', () => {
    const roteamento = JSON.parse(fs.readFileSync(path.join(RAIZ, 'governance/risk-routing/l1-scope-routing.json'), 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(roteamento.items, 'L1-NPM-TEST-CI-VERMELHO')).toBe(false);
    // Mesmo sem rota, a decisão continua negada — remover a linha não fecha o defeito.
    const inv = inventarioReal();
    const decisao = ATUAL.eligibility.evaluateExecutionEligibility(
      { commit: SHA, actor: { id: 'teste', kind: 'script' }, defects: inv.defeitos },
      'SELO_FINAL',
    );
    expect(decisao.allowed).toBe(false);
  });
});
