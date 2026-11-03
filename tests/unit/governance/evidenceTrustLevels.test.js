'use strict';

/**
 * FASE 3 / MISSÃO C — INTEGRIDADE ≠ AUTENTICIDADE ≠ CERTIFICAÇÃO.
 *
 * CONTEXTO DO PROBLEMA
 * --------------------
 * `artifactSha256` é calculado pelo MESMO executor: protege contra inconsistência operacional,
 * mas quem reescreve manifesto + artefatos e recalcula os hashes passa. Se "os hashes conferem"
 * for lido como "a prova vale", a evidência adquire autoridade certificante sem nunca ter sido
 * autenticada por chave, ancorada fora da árvore ou decidida por GO canônico.
 *
 * O que este arquivo trava:
 *   1. cada nível de confiança EXIGE o anterior (nunca é saltado);
 *   2. integridade local NUNCA implica certificação;
 *   3. adulteração com hash recalculado chega no máximo a `PROVENANCE` e nomeia o bloqueio;
 *   4. replay (reutilizar runId / trocar commit) é bloqueado em `RUN_IDENTITY`/`PROVENANCE`;
 *   5. cobertura integral declarada com dados parciais não vira `CERTIFIED`;
 *   6. `agregar()` do regularizador DECLARA o nível e nunca afirma `certificante:true` sem
 *      assinatura + âncora + GO (que este ambiente não possui — e o módulo não fabrica).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { NIVEIS, ORDEM, classificarEvidencia, proximoNivel } = require('../../../governance/proof-engine/evidence-trust');
const runLib = require('../../../scripts/governance/lib/regularizationRun');

const BASE = path.join('AI_MEMORY', 'evidence', 'bug-closure-regularization');

const tudoOk = () => ({
  integridadeOk: true,
  runIdCoerente: true,
  identidadeCoerente: true,
  provenienciaConfere: true,
  assinatura: { verificada: true },
  ancoraExterna: { confere: true },
  decisaoCanonica: { goDefinitivo: true },
});

describe('P3-C — níveis de confiança da evidência', () => {
  test('cada nível exige o anterior: sem integridade não há identidade de run', () => {
    const r = classificarEvidencia({ ...tudoOk(), integridadeOk: false });
    expect(r.nivel).toBe('NENHUM');
    expect(r.alcancados).toEqual([]);
    expect(r.certificante).toBe(false);
    expect(r.bloqueios[0]).toEqual({ nivel: NIVEIS.LOCAL_INTEGRITY, motivo: 'HASH_OU_PARSE_INVALIDO' });
  });

  test('integridade local NUNCA implica certificação (o ponto central da missão)', () => {
    const r = classificarEvidencia({ integridadeOk: true, runIdCoerente: true, identidadeCoerente: true });
    expect(r.nivel).toBe(NIVEIS.RUN_IDENTITY);
    expect(r.certificante).toBe(false);
    expect(r.bloqueios.map((b) => b.nivel)).toContain(NIVEIS.PROVENANCE);
  });

  test('adulteração com hashes recalculados chega no máximo a PROVENANCE (sem assinatura)', () => {
    // Cenário: atacante reescreveu manifesto+itens e RECALCULOU artifactSha256.
    const r = classificarEvidencia({
      ...tudoOk(),
      assinatura: { verificada: false, motivo: 'SEM_ASSINATURA_VERIFICADA' },
      ancoraExterna: { confere: false, motivo: 'SEM_ANCORA_EXTERNA' },
      decisaoCanonica: { goDefinitivo: false, motivo: 'DECISAO_NAO_E_GO_DEFINITIVO' },
    });
    expect(r.nivel).toBe(NIVEIS.PROVENANCE);
    expect(r.certificante).toBe(false);
    expect(r.bloqueios.map((b) => b.nivel)).toEqual([
      NIVEIS.CRYPTOGRAPHIC_AUTHENTICITY,
      NIVEIS.EXTERNAL_ANCHOR,
      NIVEIS.CERTIFIED,
    ]);
  });

  test('replay: runId reutilizado com outra identidade bloqueia em RUN_IDENTITY', () => {
    const r = classificarEvidencia({ ...tudoOk(), identidadeCoerente: false });
    expect(r.nivel).toBe(NIVEIS.LOCAL_INTEGRITY);
    expect(r.bloqueios[0]).toEqual({ nivel: NIVEIS.RUN_IDENTITY, motivo: 'IDENTIDADE_DIVERGENTE' });
  });

  test('artefato de OUTRO run colocado na execução bloqueia em RUN_IDENTITY', () => {
    const r = classificarEvidencia({ ...tudoOk(), runIdCoerente: false });
    expect(r.nivel).toBe(NIVEIS.LOCAL_INTEGRITY);
    expect(r.bloqueios[0]).toEqual({ nivel: NIVEIS.RUN_IDENTITY, motivo: 'RUN_ID_DIVERGENTE' });
  });

  test('proveniência divergente do inventário real bloqueia antes de qualquer autenticação', () => {
    const r = classificarEvidencia({ ...tudoOk(), provenienciaConfere: false });
    expect(r.nivel).toBe(NIVEIS.RUN_IDENTITY);
    expect(r.bloqueios[0]).toEqual({ nivel: NIVEIS.PROVENANCE, motivo: 'PROVENIENCIA_NAO_CONFERE' });
  });

  test('CERTIFIED só no topo da cadeia, com TODOS os elementos', () => {
    const r = classificarEvidencia(tudoOk());
    expect(r.nivel).toBe(NIVEIS.CERTIFIED);
    expect(r.certificante).toBe(true);
    expect(r.bloqueios).toEqual([]);
    expect(r.alcancados).toEqual(ORDEM);
    expect(proximoNivel(NIVEIS.CERTIFIED)).toBeNull();
  });

  test('assinatura "verificada" é obrigatória — presença de campo não basta', () => {
    const r = classificarEvidencia({ ...tudoOk(), assinatura: { verificada: false, motivo: 'ASSINATURA_INVALIDA' } });
    expect(r.nivel).toBe(NIVEIS.PROVENANCE);
    expect(r.bloqueios[0]).toEqual({ nivel: NIVEIS.CRYPTOGRAPHIC_AUTHENTICITY, motivo: 'ASSINATURA_INVALIDA' });
  });
});

describe('P3-C — adulteração e replay contra o regularizador REAL', () => {
  const raiz = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p3c-'));
  const raizes = [];
  afterAll(() => { for (const r of raizes) fs.rmSync(r, { recursive: true, force: true }); });
  const novaRaiz = () => { const r = raiz(); raizes.push(r); return r; };

  function inventario(root, ids = ['X1', 'X2']) {
    fs.mkdirSync(path.join(root, 'AI_MEMORY'), { recursive: true });
    const itens = ids.map((id) => ({ id, severity: 'P1', state: 'VERIFIED', status: 'prevention_active', title: id }));
    fs.writeFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'), JSON.stringify({ items: itens }, null, 2), 'utf8');
    return {
      digest: require('../../../governance/bug-closure/trusted-authorities').digestDoInventario(itens),
      queueSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'))).digest('hex'),
    };
  }

  function abrirRun(root, escopo = { tipo: 'INTEGRAL' }) {
    const inf = inventario(root);
    return runLib.iniciar({
      rootDir: root,
      baseRel: BASE,
      commit: 'a'.repeat(40),
      sourceFingerprint: 'b'.repeat(64),
      inventoryFingerprint: inf.digest,
      hardeningQueueFingerprint: inf.queueSha256,
      testManifestFingerprint: 'd'.repeat(64),
      escopo,
    });
  }

  const resultado = (id) => ({ id, severity: 'P1', classe: 'X', teste: `t/${id}` });

  test('agregado de execução legítima declara PROVENANCE e NUNCA se diz certificante', () => {
    const root = novaRaiz();
    const run = abrirRun(root, { tipo: 'INTEGRAL' });
    for (const id of ['X1', 'X2']) {
      expect(runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado(id) }).ok).toBe(true);
    }
    expect(runLib.finalizar({ rootDir: root, baseRel: BASE, runId: run.runId }).ok).toBe(true);
    const agregado = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [run.runId] });
    expect(agregado.ok).toBe(true);
    expect(agregado.confianca.nivel).toBe(NIVEIS.PROVENANCE);
    expect(agregado.confianca.certificante).toBe(false);
    expect(agregado.confianca.proximoNivelExigido).toBe(NIVEIS.CRYPTOGRAPHIC_AUTHENTICITY);
    expect(agregado.confianca.bloqueios.map((b) => b.nivel)).toEqual([
      NIVEIS.CRYPTOGRAPHIC_AUTHENTICITY, NIVEIS.EXTERNAL_ANCHOR, NIVEIS.CERTIFIED,
    ]);
  });

  test('adulterar artefato e RECALCULAR o hash é detectado como identidade, não como autenticidade', () => {
    const root = novaRaiz();
    const run = abrirRun(root, { tipo: 'INTEGRAL' });
    runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    runLib.finalizar({ rootDir: root, baseRel: BASE, runId: run.runId });

    // Atacante: troca o conteúdo E recalcula `artifactSha256` (integridade interna continua "ok").
    const alvo = path.join(run.dir, 'itens', 'X1.json');
    const corpo = JSON.parse(fs.readFileSync(alvo, 'utf8'));
    corpo.classe = 'FECHADO_SEM_PROVA';
    corpo.artifactSha256 = null;
    corpo.artifactSha256 = crypto.createHash('sha256').update(JSON.stringify(corpo, null, 2)).digest('hex');
    fs.writeFileSync(alvo, `${JSON.stringify(corpo, null, 2)}\n`, 'utf8');

    const lidos = runLib.lerResultados(root, BASE, run.runId);
    // O hash interno CONFERE (o atacante recalculou) — é exatamente o limite declarado.
    expect(lidos.ok).toBe(true);
    // Mas a confiança não sobe: sem assinatura/âncora/decisão, não é certificante.
    const agregado = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [run.runId] });
    expect(agregado.confianca.certificante).toBe(false);
    expect(agregado.confianca.nivel).not.toBe(NIVEIS.CERTIFIED);
  });

  test('prova de outro commit (fila alterada depois) bloqueia a PROVENANCE', () => {
    const root = novaRaiz();
    const run = abrirRun(root, { tipo: 'INTEGRAL' });
    for (const id of ['X1', 'X2']) {
      runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado(id) });
    }
    runLib.finalizar({ rootDir: root, baseRel: BASE, runId: run.runId });

    // A fila muda DEPOIS da execução (novo commit) — o digest gravado deixa de conferir.
    const fila = JSON.parse(fs.readFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'), 'utf8'));
    fila.items.push({ id: 'X3', severity: 'P1', state: 'VERIFIED', title: 'novo' });
    fs.writeFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'), JSON.stringify(fila, null, 2), 'utf8');

    const agregado = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [run.runId] });
    expect(agregado.ok).toBe(true);
    expect(agregado.completo).toBe(false);
    expect(agregado.confianca.nivel).toBe(NIVEIS.RUN_IDENTITY);
    expect(agregado.confianca.bloqueios[0]).toEqual({ nivel: NIVEIS.PROVENANCE, motivo: 'PROVENIENCIA_NAO_CONFERE' });
  });

  test('agregado com artefato de OUTRO run nunca chega a identidade de execução', () => {
    const root = novaRaiz();
    const a = abrirRun(root, { tipo: 'PARCIAL', esperadoNoEscopo: 1 });
    const b = abrirRun(root, { tipo: 'PARCIAL', esperadoNoEscopo: 1 });
    runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: a.runId, resultado: resultado('X1') });
    runLib.finalizar({ rootDir: root, baseRel: BASE, runId: a.runId });
    runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: b.runId, resultado: resultado('X2') });
    runLib.finalizar({ rootDir: root, baseRel: BASE, runId: b.runId });

    // Copia o item de B para dentro de A (substituição de evidência entre execuções).
    fs.copyFileSync(path.join(b.dir, 'itens', 'X2.json'), path.join(a.dir, 'itens', 'X2.json'));
    const lidos = runLib.lerResultados(root, BASE, a.runId);
    expect(lidos.ok).toBe(false);
    expect(lidos.adulterados.length).toBeGreaterThan(0);
    expect(lidos.adulterados[0].motivo).toMatch(/RUN_ID_DIVERGENTE|IDENTIDADE_DIVERGENTE/);
    const agregado = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(agregado.ok).toBe(false);
    expect(agregado.motivo).toMatch(/ARTEFATO_ADULTERADO/);
  });
});
