'use strict';

/**
 * L-1 (2026-10-20) — PROVA DE FIAGEM, não só do modelo puro.
 *
 * O modelo puro passou a exigir `deliveredOk` (resultado do predicado CANÔNICO do relatório de
 * entrega). Um teste só do modelo não provaria que o serviço realmente LÊ o relatório e passa o
 * resultado: a correção poderia estar certa e a fiagem faltando — exatamente o defeito medido
 * (o modelo recebia `deliveredVerdict` e nunca o consultava).
 *
 * Aqui o `rootDir` é um diretório temporário REAL: os arquivos são escritos em disco e o
 * serviço os lê pelo mesmo caminho de código usado em produção (sem mock de `fs`).
 * Não há git no diretório temporário, portanto `head` é `null` — o que ISOLA a decisão em
 * exatamente um fator por teste (a entrega verificada ou não).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const releaseStateService = require('../../../api/services/devGovernance/releaseStateService');
const { DECISOES_ENTREGA_PERMITIDAS } = require('../../../scripts/governance/lib/delivery-verification');

const SHA = 'a'.repeat(40);

function writeJson(rootDir, relPath, payload) {
  const abs = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2));
}

function makeRoot({ deliveredReport = null, qaMesh = { status: 'GO' }, consistency = { pass: true, finalDecision: 'AUTONOMOUS_READY_GO' } } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-release-state-'));
  writeJson(rootDir, path.join('governance', '.current-run.json'), {
    runId: 'run-l1-test',
    sourceCommit: SHA,
    sourceFingerprint: 'f'.repeat(64),
    status: 'OPEN',
  });
  fs.mkdirSync(path.join(rootDir, 'dist', 'release'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'dist', 'release', 'r-agent2-20261020-120000.zip'), 'zip-bytes');
  if (qaMesh) writeJson(rootDir, path.join('qa-mesh', 'go-no-go-report.json'), qaMesh);
  if (consistency) writeJson(rootDir, path.join('dist', 'governance', 'final-consistency-report.json'), consistency);
  // CAMINHO CANÔNICO do produtor (`governance/verify-delivered-release.js`).
  if (deliveredReport) writeJson(rootDir, path.join('governance', 'delivered-release-verification-report.json'), deliveredReport);
  return rootDir;
}

function withRoot(options, run) {
  const rootDir = makeRoot(options);
  return Promise.resolve(run(rootDir)).finally(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
}

describe('releaseStateService — a entrega só é "verificada" com veredito CANÔNICO positivo', () => {
  test('SINGLE AUTHORITY: a lista local é idêntica à do juiz canônico da entrega', () => {
    expect([...releaseStateService.DELIVERED_VERIFIED_DECISIONS]).toEqual([...DECISOES_ENTREGA_PERMITIDAS]);
    expect(releaseStateService.DELIVERED_VERIFIED_DECISIONS).toContain('DELIVERED_RELEASE_VERIFIED');
  });

  test('todos os relatórios canônicos ok + entrega verificada ⇒ DELIVERED_VERIFIED', async () => {
    const rootDir = makeRoot({ deliveredReport: { decision: 'DELIVERED_RELEASE_VERIFIED' } });
    try {
      const state = await releaseStateService.getReleaseState({ rootDir });
      expect(state.verdict).toBe('DELIVERED_VERIFIED');
      expect(state.verificationGaps).toEqual([]);
      expect(state.deliveredOk).toBe(true);
      expect(state.blockers).toEqual([]);
      expect(state.evidenceUnavailable).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('relatório de entrega NEGATIVO que CONTÉM a palavra VERIFIED ⇒ DELIVERED_UNVERIFIED', async () => {
    const rootDir = makeRoot({ deliveredReport: { decision: 'NOT_VERIFIED' } });
    try {
      const state = await releaseStateService.getReleaseState({ rootDir });
      expect(state.verdict).toBe('DELIVERED_UNVERIFIED');
      expect(state.deliveredOk).toBe(false);
      expect(state.verificationGaps.map((g) => g.code)).toEqual(expect.arrayContaining([
        'DELIVERED_VERDICT_NOT_POSITIVE',
        'RELEASE_BLOCKERS_PRESENT',
      ]));
      expect(state.blockers.map((b) => b.code)).toContain('delivered_release');
      expect(state.blockers.find((b) => b.code === 'delivered_release').why).toMatch(/NOT_VERIFIED/);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('`UNVERIFIED` e estado pré-pacote também não são entrega verificada', async () => {
    const rootDir = makeRoot({ deliveredReport: { decision: 'UNVERIFIED' } });
    try {
      const state = await releaseStateService.getReleaseState({ rootDir });
      expect(state.deliveredOk).toBe(false);
      expect(state.verdict).toBe('DELIVERED_UNVERIFIED');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('relatório no caminho ANTIGO (reports/) NÃO conta como evidência', async () => {
    const rootDir = makeRoot({ deliveredReport: null });
    try {
      writeJson(rootDir, path.join('reports', 'delivered-release-verification-report.json'), { decision: 'DELIVERED_RELEASE_VERIFIED' });
      const state = await releaseStateService.getReleaseState({ rootDir });
      expect(state.verdict).toBe('DELIVERED_UNVERIFIED');
      expect(state.evidenceUnavailable.map((u) => u.code)).toContain('delivered_release');
      expect(state.verificationGaps.map((g) => g.code)).toContain('EVIDENCE_UNAVAILABLE');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('relatório de entrega AUSENTE ⇒ evidência indisponível declarada e NUNCA verificado', async () => {
    const rootDir = makeRoot({ deliveredReport: null });
    try {
      const state = await releaseStateService.getReleaseState({ rootDir });
      expect(state.verdict).toBe('DELIVERED_UNVERIFIED');
      expect(state.verdict).not.toBe('DELIVERED_VERIFIED');
      expect(state.evidenceUnavailable.map((u) => u.code)).toContain('delivered_release');
      expect(state.verificationGaps.map((g) => g.code)).toContain('EVIDENCE_UNAVAILABLE');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('QA Mesh NO_GO com entrega "verificada" ⇒ DELIVERED_UNVERIFIED (bloqueio canônico manda)', async () => {
    const rootDir = makeRoot({
      deliveredReport: { decision: 'DELIVERED_RELEASE_VERIFIED' },
      qaMesh: { status: 'NO_GO', reasons: ['cenário crítico falhou'] },
    });
    try {
      const state = await releaseStateService.getReleaseState({ rootDir });
      expect(state.verdict).toBe('DELIVERED_UNVERIFIED');
      expect(state.blockers.map((b) => b.code)).toContain('qa_mesh');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
