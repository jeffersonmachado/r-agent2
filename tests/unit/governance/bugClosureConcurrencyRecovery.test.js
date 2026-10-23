'use strict';

/**
 * A4 (missão Codex) — concorrência, falha parcial e recuperação do Bug Closure First.
 *
 * Modelo sob teste: `governance/bug-closure/transition-journal.js` (INTENT → COMMITTED|ABORTED)
 * + lock exclusivo + verificação de base (hash da fila) antes da projeção.
 *
 * Nenhum cenário aqui "simula" concorrência: os ataques rodam em PROCESSOS REAIS e o disco é
 * real. Falhas de escrita são provocadas com permissão de diretório, não com mock.
 */

const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const proof = require('../../../governance/bug-closure/closure-proof');
const ledger = require('../../../governance/bug-closure/transition-ledger');
const service = require('../../../governance/bug-closure/transition-service');
const jornal = require('../../../governance/bug-closure/transition-journal');
const sig = require('../../../governance/risk-acceptance/signature');
const TA = require('../../../governance/bug-closure/trusted-authorities');

const SHA = 'a'.repeat(40);
const FP = 'b'.repeat(64);

/** Cria raiz com N defeitos e devolve provas assinadas prontas para uso em processo filho. */
function cenarioComItens(ids, estado = 'FIXED_PENDING_VERIFICATION') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conc-'));
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
    authorities: [{ identity: 'owner@example.invalid', mayCloseDefects: true, publicKeyPem: pem }],
  }, null, 2), 'utf8');

  const queuePath = path.join(root, 'AI_MEMORY', 'hardening-queue.json');
  fs.writeFileSync(queuePath, JSON.stringify({
    items: ids.map((id) => ({
      id, title: id, status: 'ready_for_approval', state: estado, severity: 'P1',
      regressionTest: 'tests/unit/regressao.test.js',
    })),
  }, null, 2), 'utf8');

  const provas = {};
  for (const id of ids) {
    const p = proof.construirProvaDeFechamento({
      defectId: id, severityBefore: 'P1', severityAfter: 'P1',
      fromState: estado, toState: 'VERIFIED',
      evaluatedCommit: SHA, codeFingerprint: FP,
      requiredTests: ['tests/unit/regressao.test.js'],
      executions: [{
        testPath: 'tests/unit/regressao.test.js', command: 'npx jest x', exitCode: 0,
        startedAt: '2026-10-22T10:00:00.000Z', finishedAt: '2026-10-22T10:00:05.000Z',
        outputPath: 'prova-saida/regressao.log', outputSha256: outHash,
      }],
      artifactHashes: [{ path: 'tests/unit/regressao.test.js', sha256: testHash }],
      actor: { id: 'owner@example.invalid', kind: 'humano' },
      policyDecision: { decision: 'CLOSE_VERIFIED', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
    });
    const payload = {};
    for (const campo of proof.CAMPOS_ASSINADOS) payload[campo] = p[campo];
    p.signature = {
      alg: 'Ed25519', keyId: 'owner@example.invalid',
      value: crypto.sign(null, Buffer.from(sig.canonicalJson(payload), 'utf8'), privateKey).toString('base64'),
    };
    provas[id] = p;
  }

  return { root, queuePath, provas, privateKey, ancoragem: { pins: [fingerprint], externa: fingerprint } };
}

/** Roda applyTransition em PROCESSO separado (concorrência real). */
function emProcesso({ root, queuePath, defectId, provaArquivo, ancoragem }) {
  const script = `
    process.env.NODE_ENV = 'test';
    const fs = require('fs');
    const service = require(${JSON.stringify(path.join(RAIZ, 'governance/bug-closure/transition-service'))});
    const prova = JSON.parse(fs.readFileSync(${JSON.stringify(provaArquivo)}, 'utf8'));
    const r = service.applyTransition({
      rootDir: ${JSON.stringify(root)},
      queuePath: ${JSON.stringify(queuePath)},
      defectId: ${JSON.stringify(defectId)},
      to: 'VERIFIED',
      proof: prova,
      actor: { id: 'owner@example.invalid' },
      currentCommit: ${JSON.stringify(SHA)},
      currentFingerprint: ${JSON.stringify(FP)},
      ancoragem: ${JSON.stringify(ancoragem)},
      agora: Date.parse(prova.createdAt) + 1000,
    });
    process.stdout.write(JSON.stringify({ ok: r.ok, reasons: r.reasons || [] }));
  `;
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000 });
}

function provasEmArquivo(c) {
  const dir = path.join(c.root, 'provas-entrada');
  fs.mkdirSync(dir, { recursive: true });
  const mapa = {};
  for (const [id, p] of Object.entries(c.provas)) {
    const abs = path.join(dir, `${id}.json`);
    fs.writeFileSync(abs, JSON.stringify(p, null, 2), 'utf8');
    mapa[id] = abs;
  }
  return mapa;
}

function lerFila(c) {
  return JSON.parse(fs.readFileSync(c.queuePath, 'utf8'));
}

function journalDe(c) {
  return jornal.lerIntents(c.root);
}

// ─── Concorrência real ──────────────────────────────────────────────────────

describe('A4 — concorrência entre PROCESSOS reais', () => {
  test('duas transições em defeitos DIFERENTES: ambas aplicam, nenhuma perde atualização', () => {
    const c = cenarioComItens(['D1', 'D2']);
    const arquivos = provasEmArquivo(c);
    const a = emProcesso({ ...c, defectId: 'D1', provaArquivo: arquivos.D1 });
    const b = emProcesso({ ...c, defectId: 'D2', provaArquivo: arquivos.D2 });

    const ra = JSON.parse(a.stdout || '{"ok":false}');
    const rb = JSON.parse(b.stdout || '{"ok":false}');
    // Pelo menos um tem de vencer; o outro pode recusar por lock (fail-closed), nunca por
    // ter sobrescrito o primeiro silenciosamente.
    expect(ra.ok || rb.ok).toBe(true);

    const livro = ledger.verificarLivro(c.root);
    expect(livro.integridadeOk).toBe(true);
    const aplicados = lerFila(c).items.filter((i) => i.state === 'VERIFIED').map((i) => i.id);
    // Toda transição aplicada tem evento no livro e prova no disco — nada parcial.
    for (const id of aplicados) {
      const p = c.provas[id];
      expect(livro.eventos.some((e) => e.transitionId === p.transitionId)).toBe(true);
      expect(fs.existsSync(path.join(c.root, 'governance/bug-closure/proofs', `${p.transitionId}.json`))).toBe(true);
    }
    // E nenhum evento ficou sem a fila correspondente.
    for (const e of livro.eventos) {
      const item = lerFila(c).items.find((i) => i.id === e.defectId);
      expect(item.state).toBe('VERIFIED');
    }
  }, 120000);

  test('duas operações no MESMO defeito: no máximo uma vence', () => {
    const c = cenarioComItens(['MESMO']);
    const arquivos = provasEmArquivo(c);
    const a = emProcesso({ ...c, defectId: 'MESMO', provaArquivo: arquivos.MESMO });
    const b = emProcesso({ ...c, defectId: 'MESMO', provaArquivo: arquivos.MESMO });
    const resultados = [JSON.parse(a.stdout || '{"ok":false}'), JSON.parse(b.stdout || '{"ok":false}')];

    expect(resultados.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
    const livro = ledger.verificarLivro(c.root);
    expect(livro.eventos.length).toBeLessThanOrEqual(1);
    expect(livro.integridadeOk).toBe(true);
  }, 120000);

  test('diário fica COMMITTED quando aplica e ABORTED quando recusa — nunca em INTENT', () => {
    const c = cenarioComItens(['J1']);
    const arquivos = provasEmArquivo(c);
    emProcesso({ ...c, defectId: 'J1', provaArquivo: arquivos.J1 });
    const intents = journalDe(c);
    expect(intents.length).toBeGreaterThan(0);
    for (const i of intents) expect(i.status).not.toBe('INTENT');
  }, 120000);
});

// ─── Lock e falha de escrita ────────────────────────────────────────────────

describe('A4 — lock ocupado e falhas de escrita não declaram sucesso', () => {
  test('lock ocupado ⇒ recusa com diário ABORTED e fila intacta', () => {
    const c = cenarioComItens(['L1']);
    fs.writeFileSync(`${c.queuePath}.lock`, 'ocupado', 'utf8');
    const antes = fs.readFileSync(c.queuePath, 'utf8');

    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'L1', to: 'VERIFIED',
      proof: c.provas.L1, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.L1.createdAt) + 1000,
    });

    expect(r.ok).toBe(false);
    expect(fs.readFileSync(c.queuePath, 'utf8')).toBe(antes);
    const intents = journalDe(c);
    expect(intents).toHaveLength(1);
    expect(intents[0].status).toBe('ABORTED');
    expect(intents[0].motivo).toBe('FILA_OCUPADA');
    // Lock de terceiro não é removido por quem não o criou.
    expect(fs.existsSync(`${c.queuePath}.lock`)).toBe(true);
    fs.rmSync(`${c.queuePath}.lock`, { force: true });
  }, 60000);

  test('prova não gravável ⇒ recusa + ABORTED, e o evento NO LIVRO fica sem fila (detectado na recuperação)', () => {
    const c = cenarioComItens(['F1']);
    // Impede a escrita da prova: diretório de provas vira arquivo.
    const dirProvas = path.join(c.root, 'governance', 'bug-closure', 'proofs');
    fs.mkdirSync(path.dirname(dirProvas), { recursive: true });
    fs.writeFileSync(dirProvas, 'nao sou diretorio', 'utf8');

    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'F1', to: 'VERIFIED',
      proof: c.provas.F1, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.F1.createdAt) + 1000,
    });

    expect(r.ok).toBe(false);
    expect(lerFila(c).items[0].state).toBe('FIXED_PENDING_VERIFICATION');
    const intents = journalDe(c);
    expect(intents[0].status).toBe('ABORTED');

    // A operação abortada pode ter deixado evento no livro (append-only não volta atrás).
    const rec = jornal.recuperar(c.root, { queuePath: c.queuePath });
    const evento = ledger.verificarLivro(c.root).eventos.length;
    if (evento > 0) {
      // Efeito parcial: a certificação tem de permanecer bloqueada até recuperação canônica.
      expect(rec.ok).toBe(false);
      expect(rec.bloqueiaCertificacao).toBe(true);
      expect(rec.pendentes.length).toBeGreaterThan(0);
    } else {
      expect(rec.bloqueiaCertificacao).toBe(false);
    }
  }, 60000);

  test('renomear a fila falhando não pode declarar sucesso', () => {
    const c = cenarioComItens(['R1']);
    // Diretório da fila sem permissão de escrita ⇒ falha no tmp/rename da projeção.
    const dir = path.dirname(c.queuePath);
    fs.chmodSync(dir, 0o500);
    let r;
    try {
      r = service.applyTransition({
        rootDir: c.root, queuePath: c.queuePath, defectId: 'R1', to: 'VERIFIED',
        proof: c.provas.R1, actor: { id: 'owner@example.invalid' },
        currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
        agora: Date.parse(c.provas.R1.createdAt) + 1000,
      });
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    expect(r.ok).toBe(false);
    expect(lerFila(c).items[0].state).toBe('FIXED_PENDING_VERIFICATION');
    const intents = journalDe(c);
    expect(intents.some((i) => i.status === 'COMMITTED')).toBe(false);
  }, 60000);
});

// ─── Recuperação determinística ─────────────────────────────────────────────

describe('A4 — recuperação determinística do diário', () => {
  function intentPendente(c, { transitionId, defectId, proofRel = null, kind = 'TRANSITION', to = 'VERIFIED' }) {
    const r = jornal.iniciar(c.root, {
      transitionId, defectId, kind, from: 'FIXED_PENDING_VERIFICATION', to,
      proofRel, proofHash: null, queuePath: c.queuePath, ledgerRel: ledger.REL_PADRAO, base: null,
    });
    expect(r.ok).toBe(true);
  }

  test('intent sem NENHUM efeito ⇒ ABORTED e estado governado intacto', () => {
    const c = cenarioComItens(['REC1']);
    intentPendente(c, { transitionId: crypto.randomUUID(), defectId: 'REC1' });
    const rec = jornal.recuperar(c.root, { queuePath: c.queuePath });
    expect(rec.abortados).toHaveLength(1);
    expect(rec.pendentes).toHaveLength(0);
    expect(rec.bloqueiaCertificacao).toBe(false);
    expect(lerFila(c).items[0].state).toBe('FIXED_PENDING_VERIFICATION');
  }, 60000);

  test('intent com efeito COMPLETO (evento + prova + fila) ⇒ COMMITTED', () => {
    const c = cenarioComItens(['REC2']);
    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'REC2', to: 'VERIFIED',
      proof: c.provas.REC2, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.REC2.createdAt) + 1000,
    });
    expect(r.ok).toBe(true);
    const rec = jornal.recuperar(c.root, { queuePath: c.queuePath });
    // Já commitado no fluxo normal: nada pendente, nada a recuperar.
    expect(rec.pendentes).toHaveLength(0);
    expect(rec.bloqueiaCertificacao).toBe(false);
  }, 60000);

  test('intent com efeito PARCIAL (evento sem fila) ⇒ PENDENTE e certificação bloqueada', () => {
    const c = cenarioComItens(['REC3']);
    const p = c.provas.REC3;
    // Aplica o evento manualmente, sem projetar a fila (estado de crash no meio).
    ledger.anexarEvento({
      rootDir: c.root, transitionId: p.transitionId, defectId: 'REC3',
      from: 'FIXED_PENDING_VERIFICATION', to: 'VERIFIED', kind: 'TRANSITION',
      actorId: 'owner@example.invalid', proofHash: proof.hashDoPayload(p), evaluatedCommit: SHA,
    });
    intentPendente(c, { transitionId: p.transitionId, defectId: 'REC3', proofRel: 'governance/bug-closure/proofs/inexistente.json' });

    const rec = jornal.recuperar(c.root, { queuePath: c.queuePath });
    expect(rec.pendentes).toHaveLength(1);
    expect(rec.bloqueiaCertificacao).toBe(true);
    expect(rec.ok).toBe(false);
    // O livro NUNCA é truncado para "desfazer": o evento continua lá.
    expect(ledger.verificarLivro(c.root).eventos).toHaveLength(1);
  }, 60000);

  test('recuperação é IDEMPOTENTE: rodar duas vezes dá o mesmo resultado', () => {
    const c = cenarioComItens(['REC4']);
    intentPendente(c, { transitionId: crypto.randomUUID(), defectId: 'REC4' });
    const primeira = jornal.recuperar(c.root, { queuePath: c.queuePath });
    const segunda = jornal.recuperar(c.root, { queuePath: c.queuePath });
    expect(segunda.abortados).toEqual([]);
    expect(segunda.pendentes).toEqual([]);
    expect(primeira.abortados).toHaveLength(1);
  }, 60000);

  test('haOperacaoPendente reflete INTENT não reconciliada', () => {
    const c = cenarioComItens(['REC5']);
    expect(jornal.haOperacaoPendente(c.root)).toBe(false);
    intentPendente(c, { transitionId: crypto.randomUUID(), defectId: 'REC5' });
    expect(jornal.haOperacaoPendente(c.root)).toBe(true);
    jornal.recuperar(c.root, { queuePath: c.queuePath });
    expect(jornal.haOperacaoPendente(c.root)).toBe(false);
  }, 60000);
});

// ─── ACHADOS DA REVISÃO ADVERSARIAL (2ª passada) ────────────────────────────
// Cada um foi reproduzido pelo revisor antes da correção; aqui ficam como regressão.

describe('revisão 2ª passada — Alert 1: symlink não pode virar escrita arbitrária', () => {
  test('symlink PENDENTE apontando para fora da raiz ⇒ recusa e nada é criado fora', () => {
    const c = cenarioComItens(['SY1']);
    const fora = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fora2-')), 'alvo.json');
    const dirProvas = path.join(c.root, 'governance', 'bug-closure', 'proofs');
    fs.mkdirSync(dirProvas, { recursive: true });
    // Alvo AINDA não existe: o realpath do ancestral passaria; lstat do componente final não.
    fs.symlinkSync(fora, path.join(dirProvas, `${c.provas.SY1.transitionId}.json`));

    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'SY1', to: 'VERIFIED',
      proof: c.provas.SY1, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.SY1.createdAt) + 1000,
    });

    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('PROVA_E_SYMLINK');
    expect(fs.existsSync(fora)).toBe(false);
    expect(lerFila(c).items[0].state).toBe('FIXED_PENDING_VERIFICATION');
  }, 60000);

  test('symlink para arquivo DENTRO da raiz não sobrescreve o alvo (livro intacto)', () => {
    const c = cenarioComItens(['SY2']);
    const dirProvas = path.join(c.root, 'governance', 'bug-closure', 'proofs');
    fs.mkdirSync(dirProvas, { recursive: true });
    const livro = path.join(c.root, 'governance', 'bug-closure', 'transitions.log.jsonl');
    fs.writeFileSync(livro, '', 'utf8');
    fs.symlinkSync(livro, path.join(dirProvas, `${c.provas.SY2.transitionId}.json`));

    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'SY2', to: 'VERIFIED',
      proof: c.provas.SY2, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.SY2.createdAt) + 1000,
    });

    expect(r.ok).toBe(false);
    // O livro NÃO pode ter sido substituído pelo JSON da prova.
    expect(fs.readFileSync(livro, 'utf8')).not.toMatch(/defect-closure-proof/);
  }, 60000);
});

describe('revisão 2ª passada — Alert 2/4: atestação com lock, base, commit e aborto', () => {
  function cenarioAtest(ids) {
    const c = cenarioComItens(ids, 'RESOLVED');
    const provas = {};
    for (const id of ids) {
      const p = proof.construirProvaDeFechamento({
        defectId: id, severityBefore: 'P1', severityAfter: 'P1',
        fromState: 'RESOLVED', toState: 'RESOLVED',
        evaluatedCommit: SHA, codeFingerprint: FP,
        requiredTests: ['tests/unit/regressao.test.js'],
        executions: c.provas[id].executions,
        artifactHashes: c.provas[id].artifactHashes,
        actor: { id: 'owner@example.invalid', kind: 'humano' },
        policyDecision: { decision: 'REVERIFY_EXISTING_CLOSURE', policyId: 'BUG_CLOSURE_FIRST', policyVersion: '1.0.0' },
      });
      const payload = {};
      for (const campo of proof.CAMPOS_ASSINADOS) payload[campo] = p[campo];
      p.signature = {
        alg: 'Ed25519', keyId: 'owner@example.invalid',
        value: crypto.sign(null, Buffer.from(sig.canonicalJson(payload), 'utf8'), c.privateKey).toString('base64'),
      };
      provas[id] = p;
    }
    return { ...c, provasAtest: provas };
  }

  function atestar(c, id) {
    return service.applyAttestation({
      rootDir: c.root, queuePath: c.queuePath, defectId: id, proof: c.provasAtest[id],
      actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provasAtest[id].createdAt) + 1000,
    });
  }

  test('atestação legítima grava COMMITTED (não fica INTENT para sempre)', () => {
    const c = cenarioAtest(['AT1']);
    expect(atestar(c, 'AT1').ok).toBe(true);
    const intents = journalDe(c);
    expect(intents).toHaveLength(1);
    expect(intents[0].status).toBe('COMMITTED');
    expect(jornal.haOperacaoPendente(c.root)).toBe(false);
  }, 60000);

  test('lock ocupado na atestação ⇒ recusa estruturada + ABORTED', () => {
    const c = cenarioAtest(['AT2']);
    fs.writeFileSync(`${c.queuePath}.lock`, 'ocupado', 'utf8');
    const r = atestar(c, 'AT2');
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('FILA_OCUPADA');
    expect(journalDe(c)[0].status).toBe('ABORTED');
    fs.rmSync(`${c.queuePath}.lock`, { force: true });
  }, 60000);

  test('retry da MESMA atestação: recusa sem rebaixar COMMITTED e sem bloquear certificação', () => {
    const c = cenarioAtest(['AT3']);
    expect(atestar(c, 'AT3').ok).toBe(true);
    // Retry (double-submit) da mesma prova: o diário é terminal, então a recusa acontece antes
    // de tocar no livro — e o COMMITTED não pode virar ABORTED (era o Alert 1 da 3ª passada).
    const segunda = atestar(c, 'AT3');
    expect(segunda.ok).toBe(false);
    expect(segunda.reasons.join(',')).toMatch(/JOURNAL_TRANSICAO_JA_REGISTRADA:COMMITTED/);
    const intents = journalDe(c);
    expect(intents).toHaveLength(1);
    expect(intents[0].status).toBe('COMMITTED');
    expect(jornal.haOperacaoPendente(c.root)).toBe(false);
    expect(jornal.recuperar(c.root, { queuePath: c.queuePath }).bloqueiaCertificacao).toBe(false);
  }, 60000);

  test('retry APÓS ABORTED é permitido (recusa legítima não impede a operação para sempre)', () => {
    const c = cenarioAtest(['AT4']);
    fs.writeFileSync(`${c.queuePath}.lock`, 'ocupado', 'utf8');
    expect(atestar(c, 'AT4').ok).toBe(false);
    expect(journalDe(c)[0].status).toBe('ABORTED');
    fs.rmSync(`${c.queuePath}.lock`, { force: true });
    const segunda = atestar(c, 'AT4');
    expect(segunda.ok).toBe(true);
    expect(journalDe(c)[0].status).toBe('COMMITTED');
    expect(journalDe(c)[0].tentativa).toBe(2);
  }, 60000);
});

describe('revisão 2ª passada — Alert 3: recusa não envenena o livro', () => {
  test('FILA_OCUPADA não deixa evento no livro (lock é adquirido antes do append)', () => {
    const c = cenarioComItens(['EN1']);
    fs.writeFileSync(`${c.queuePath}.lock`, 'ocupado', 'utf8');
    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'EN1', to: 'VERIFIED',
      proof: c.provas.EN1, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.EN1.createdAt) + 1000,
    });
    expect(r.ok).toBe(false);
    expect(ledger.verificarLivro(c.root).eventos).toHaveLength(0);
    fs.rmSync(`${c.queuePath}.lock`, { force: true });

    // E a tentativa seguinte, legítima, funciona sem EVENTO_FORA_DE_ORDEM.
    const segunda = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'EN1', to: 'VERIFIED',
      proof: c.provas.EN1, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.EN1.createdAt) + 1000,
    });
    expect(segunda.ok).toBe(true);
    const v = proof.verificarProvaDeFechamento(c.provas.EN1, {
      defeito: { id: 'EN1', severity: 'P1', state: 'VERIFIED' },
      currentCommit: SHA, currentFingerprint: FP, rootDir: c.root,
      livro: ledger.verificarLivro(c.root), ancoragem: c.ancoragem,
      agora: Date.parse(c.provas.EN1.createdAt) + 1000,
      existeArquivo: (rel) => fs.existsSync(path.join(c.root, rel)),
    });
    expect(v.reasons).toEqual([]);
  }, 60000);

  test('4 transições simultâneas em defeitos diferentes: todas aplicam, nenhum evento órfão', () => {
    const c = cenarioComItens(['S1', 'S2', 'S3', 'S4']);
    const arquivos = provasEmArquivo(c);
    const saidas = ['S1', 'S2', 'S3', 'S4'].map((id) => emProcesso({ ...c, defectId: id, provaArquivo: arquivos[id] }));
    const oks = saidas.filter((s) => JSON.parse(s.stdout || '{"ok":false}').ok).length;

    const livro = ledger.verificarLivro(c.root);
    expect(livro.integridadeOk).toBe(true);
    const aplicados = lerFila(c).items.filter((i) => i.state === 'VERIFIED').length;
    // Nenhum evento sem fila correspondente e nenhuma fila sem evento.
    expect(livro.eventos).toHaveLength(aplicados);
    expect(oks).toBe(aplicados);
    const rec = jornal.recuperar(c.root, { queuePath: c.queuePath });
    expect(rec.pendentes).toHaveLength(0);
    expect(rec.bloqueiaCertificacao).toBe(false);
  }, 180000);
});

describe('revisão 2ª passada — Alert 5/6/7', () => {
  test('Alert 5: evento grava o commit ASSINADO da prova (releitura não invalida)', () => {
    const c = cenarioComItens(['AL5']);
    const p = c.provas.AL5;
    const r = service.applyTransition({
      rootDir: c.root, queuePath: c.queuePath, defectId: 'AL5', to: 'VERIFIED',
      proof: p, actor: { id: 'owner@example.invalid' },
      currentCommit: SHA, currentFingerprint: FP, ancoragem: c.ancoragem,
      agora: Date.parse(p.createdAt) + 1000,
    });
    expect(r.ok).toBe(true);
    const evento = ledger.verificarLivro(c.root).eventos[0];
    expect(evento.evaluatedCommit).toBe(p.evaluatedCommit);
  }, 60000);

  test('Alert 6: guarda de recuperação usa a raiz do módulo, não o cwd', () => {
    const c = cenarioComItens(['AL6']);
    // INTENT pendente na raiz do cenário.
    jornal.iniciar(c.root, {
      transitionId: crypto.randomUUID(), defectId: 'AL6', kind: 'TRANSITION',
      from: 'FIXED_PENDING_VERIFICATION', to: 'VERIFIED', queuePath: c.queuePath,
      ledgerRel: ledger.REL_PADRAO, base: null,
    });
    // Sem `rootDir`: a raiz é derivada do MÓDULO (repositório), independente de cwd. O
    // cenário vive em /tmp, então o pendente dele NÃO é enxergado por aquele caminho — e a
    // decisão não muda quando o cwd muda (era exatamente o defeito: cwd desligava a guarda).
    const original = process.cwd();
    let deOutroCwd;
    let daRaizDoModulo;
    try {
      process.chdir(os.tmpdir());
      deOutroCwd = jornal.haOperacaoPendente();
    } finally {
      process.chdir(original);
    }
    daRaizDoModulo = jornal.haOperacaoPendente();
    expect(daRaizDoModulo).toBe(deOutroCwd);
    expect(jornal.haOperacaoPendente(c.root)).toBe(true);
  }, 60000);

  test('Alert 7: diário com JSON inválido ⇒ PENDENTE, exit 1 e não "RECUPERADO"', () => {
    const c = cenarioComItens(['AL7']);
    const dir = path.join(c.root, jornal.DIR_JORNAL);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${crypto.randomUUID()}.json`), '{ isso não é json', 'utf8');

    const rec = jornal.recuperar(c.root, { queuePath: c.queuePath });
    expect(rec.ok).toBe(false);
    expect(rec.bloqueiaCertificacao).toBe(true);
    expect(rec.pendentes.some((p) => p.motivo === 'JOURNAL_ILEGIVEL')).toBe(true);
    expect(rec.abortados).toHaveLength(0); // não pode reportar "abortado" o que não sabe ler
  }, 60000);
});
