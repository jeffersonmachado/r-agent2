'use strict';

/**
 * Regressão do cache de `getBusinessGaps` (2026-10-19).
 *
 * Defeito medido que originou o cache: `computeBusinessGaps` lê
 * `scenario-store.json` (1,7 MB), `journey-contracts.json` e todo o diretório
 * `qa-waves/journey-coverage/` de forma síncrona por requisição. Medições no
 * runtime real do ciclo de selagem:
 *   1 requisição ......... 260-420 ms
 *   25 concorrentes ...... p50 3693 ms / máx 7454 ms (serializa ~300 ms cada)
 * No mesh canônico a rota estourou o timeout de 30 s do client e
 * `fitness-matricula-leads` falhou com `HTTP Error 408` →
 * `CRITICAL_DOMAIN_FAILED:omnichannel` → mesh NO_GO → selo abortado.
 *
 * O que este teste trava (nos dois sentidos — cache rápido E cache honesto):
 *  1. hit NÃO re-lê o store (o ganho real, medido pela contagem de leituras);
 *  2. MUDANÇA no arquivo INVALIDA o snapshot (nunca servir dado velho);
 *  3. o caller não contamina o cache mutando o retorno;
 *  4. filtros diferentes não compartilham entrada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-bg-cache-'));
const STORE_PATH = path.join(TMP_DIR, 'scenario-store.json');
const COOLDOWN_MS = '0';
process.env.QA_WAVES_SCENARIO_STORE_PATH = STORE_PATH;
process.env.QA_WAVES_BUSINESS_GAPS_COOLDOWN_MS = COOLDOWN_MS;
process.env.QA_WAVES_BUSINESS_GAPS_TTL_MS = '60000';

const service = require('../../api/services/qaWavesIntelligenceService');

function writeStore(scenarios) {
  fs.writeFileSync(STORE_PATH, JSON.stringify({
    version: 1,
    scenarios,
    history: {},
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

function scenario(id, { journey = 'leads', status = 'approved' } = {}) {
  return {
    id,
    tenantId: 'system',
    vertical: 'fitness',
    // `waveId` é obrigatório em normalizeScenarioRecord: sem ele o cenário é
    // descartado como inválido no dedupe do store e o fixture não exercita
    // nada (medido: cenário silenciosamente removido).
    waveId: 'wave-fitness',
    journey,
    status,
    steps: [],
  };
}

function fitnessLeadsEntry(payload) {
  const entry = (payload.verticals || []).find(
    (item) => item.vertical === 'fitness' && item.journeyId === 'leads',
  );
  expect(entry).toBeDefined();
  return entry;
}

describe('getBusinessGaps — cache derivado com invalidação por arquivo', () => {
  afterAll(() => {
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('hit não re-lê o scenario-store (ganho medido: 838 ms → ~1 ms)', () => {
    writeStore([scenario('fit-leads-1')]);
    service.getBusinessGaps({ tenantId: 'system' });

    const readsBefore = fs.readFileSync;
    let storeReads = 0;
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
      if (path.resolve(String(file)) === path.resolve(STORE_PATH)) storeReads += 1;
      return readsBefore(file, ...rest);
    });

    try {
      const second = service.getBusinessGaps({ tenantId: 'system' });
      const third = service.getBusinessGaps({ tenantId: 'system' });
      expect(storeReads).toBe(0);
      expect(second).toEqual(third);
      expect(fitnessLeadsEntry(second).coverage.approvedScenarios).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('mudança no store invalida o snapshot (nunca serve dado velho)', () => {
    writeStore([scenario('fit-leads-1')]);
    const before = service.getBusinessGaps({ tenantId: 'system', vertical: 'fitness' });
    expect(fitnessLeadsEntry(before).coverage.approvedScenarios).toBe(1);

    writeStore([scenario('fit-leads-1'), scenario('fit-leads-2')]);
    const after = service.getBusinessGaps({ tenantId: 'system', vertical: 'fitness' });
    expect(fitnessLeadsEntry(after).coverage.approvedScenarios).toBe(2);
  });

  it('cache não é contaminado por mutação do objeto devolvido', () => {
    writeStore([scenario('fit-leads-1')]);
    const first = service.getBusinessGaps({ tenantId: 'system', vertical: 'fitness' });
    const baseline = fitnessLeadsEntry(first).coverage.approvedScenarios;

    first.verticals.length = 0;
    if (first.summary) first.summary.totalJourneys = -1;

    const second = service.getBusinessGaps({ tenantId: 'system', vertical: 'fitness' });
    expect(fitnessLeadsEntry(second).coverage.approvedScenarios).toBe(baseline);
    expect(second.summary.totalJourneys).toBeGreaterThan(0);
  });

  it('filtros diferentes têm entradas independentes', () => {
    writeStore([scenario('fit-leads-1')]);
    const all = service.getBusinessGaps({ tenantId: 'system' });
    const onlyLeads = service.getBusinessGaps({ tenantId: 'system', journey: 'leads' });
    const onlyCheckout = service.getBusinessGaps({ tenantId: 'system', journey: 'checkout' });

    expect(new Set(all.verticals.map((v) => v.journeyId)).size).toBeGreaterThan(1);
    expect(onlyLeads.verticals.every((v) => v.journeyId === 'leads')).toBe(true);
    expect(onlyCheckout.verticals.every((v) => v.journeyId === 'checkout')).toBe(true);
  });

  it('store ausente não envenena o cache nem quebra a resposta', () => {
    try {
      fs.unlinkSync(STORE_PATH);
    } catch (_) {
      /* ignore */
    }
    const payload = service.getBusinessGaps({ tenantId: 'system', vertical: 'fitness' });
    expect(Array.isArray(payload.verticals)).toBe(true);
    expect(fitnessLeadsEntry(payload).coverage.approvedScenarios).toBe(0);

    // Ao recriar o store a assinatura muda e o snapshot é reconstruído.
    writeStore([scenario('fit-leads-1')]);
    const rebuilt = service.getBusinessGaps({ tenantId: 'system', vertical: 'fitness' });
    expect(fitnessLeadsEntry(rebuilt).coverage.approvedScenarios).toBe(1);
  });
});
