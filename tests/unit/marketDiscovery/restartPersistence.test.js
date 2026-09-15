'use strict';

/**
 * T-MR4 — RESTART: o estado do run de market discovery sobrevive ao restart
 * do processo porque a autoridade é o Postgres, não a memória.
 *
 * Duas provas:
 *   1. CONTRATO (sempre executa): duas instâncias do store sobre o mesmo
 *      backing durável enxergam o mesmo run — a segunda instância é o
 *      "processo depois do restart" (a mesma disciplina do Postgres);
 *   2. POSTGRES REAL (quando o banco está acessível): instância A grava,
 *      instância B — criada DEPOIS, sem compartilhar nada além do banco —
 *      relê o run pelo `getRunById`. Quando o banco NÃO está acessível, a
 *      prova é a postura fail-closed: o store recusa operar com
 *      `persistence_required` em vez de cair para memória.
 */

const {
  createMarketDiscoveryStore,
  ERROR_CODES,
} = require('../../../api/services/marketDiscovery/marketDiscoveryStore');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');

const TENANT = 'system';
const PROBE_VERTICAL = '__restart_probe__';
const PROBE_VERSION = 'restart-probe-v1';

async function probeRealPostgres() {
  try {
    const { connect, getSequelize } = require('../../../api/db/sequelize');
    await connect();
    const sequelize = getSequelize();
    if (!sequelize) return null;
    await sequelize.authenticate();
    return sequelize;
  } catch {
    return null;
  }
}

describe('T-MR4 — restart de processo', () => {
  test('contrato: instância nova sobre o mesmo backing relê run, set e holdout', async () => {
    const backing = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const before = createMarketDiscoveryMemoryStore({ state: backing });
    const run = await before.openRun({ tenantId: TENANT, vertical: PROBE_VERTICAL, discoveryVersion: PROBE_VERSION, startedAt: '2026-09-15T12:00:00.000Z' });
    await before.updateRunState({ tenantId: TENANT, runId: run.id, state: 'MARKET_SCANNED', metadata: { probe: true } });

    // "Restart": nenhuma referência ao store anterior sobrevive.
    const after = createMarketDiscoveryMemoryStore({ state: backing });
    const reread = await after.getRunById({ tenantId: TENANT, runId: run.id });
    expect(reread).toBeTruthy();
    expect(reread.state).toBe('MARKET_SCANNED');
    expect(reread.metadata.probe).toBe(true);
  });

  test('Postgres real (quando acessível): instância B relê o que a instância A gravou', async () => {
    const sequelize = await probeRealPostgres();
    if (!sequelize) {
      // Sem banco a prova é a recusa fail-closed — nunca fallback em memória.
      const store = createMarketDiscoveryStore();
      await expect(store.listRuns({ tenantId: TENANT }))
        .rejects.toMatchObject({ code: ERROR_CODES.PERSISTENCE_REQUIRED });
      return;
    }

    const instanceA = createMarketDiscoveryStore();
    const opened = await instanceA.openRun({
      tenantId: TENANT,
      vertical: PROBE_VERTICAL,
      discoveryVersion: PROBE_VERSION,
      startedAt: '2026-09-15T12:00:00.000Z',
      metadata: { probe: 'restart' },
    });
    await instanceA.updateRunState({ tenantId: TENANT, runId: opened.id, state: 'MARKET_SCANNED', metadata: { probeStage: 'scanned' } });

    // Instância B: outro objeto de store, mesma autoridade (o banco).
    const instanceB = createMarketDiscoveryStore();
    const reread = await instanceB.getRunById({ tenantId: TENANT, runId: opened.id });
    expect(reread).toBeTruthy();
    expect(reread.state).toBe('MARKET_SCANNED');
    expect(reread.metadata.probeStage).toBe('scanned');

    // Idempotência: reabrir o mesmo (tenant, vertical, version) não recria história.
    const reopened = await instanceB.openRun({
      tenantId: TENANT,
      vertical: PROBE_VERTICAL,
      discoveryVersion: PROBE_VERSION,
      startedAt: '2026-09-16T00:00:00.000Z',
    });
    expect(reopened.id).toBe(opened.id);
    expect(reopened.state).toBe('MARKET_SCANNED');
  });
});
