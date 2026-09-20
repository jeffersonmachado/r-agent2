'use strict';

/**
 * T27 — timeout explícito da suíte de idempotência do webhook WhatsApp.
 * Defeito medido em 2026-09-20 (fase final do release seal#11, run
 * rap-governed-20260920181847967-96783363): a suíte leva 8,3-8,9s ociosa
 * (boot do server + POST real) contra o testTimeout global de 10s do
 * jest.config.cjs; sob a carga do converge (evidência executável em
 * paralelo com enterprise proof + API servindo jobs) ela estourou 10s e o
 * relatório reports/webhook-replay-protection-report.json saiu FAIL →
 * RAP-075 abaixo de 10 → SEAL_NO_GO com o release pronto para selar.
 * O padrão do repo para suítes que sobem o server é declarar
 * jest.setTimeout explícito (evoSyncIntegration/evoWebhookSecurity usam
 * 120s). Não é "aumentar TTL para passar": o orçamento tem que cobrir a
 * carga de trabalho real da suíte no host de QA, com margem.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SUITE = fs.readFileSync(path.join(ROOT, 'tests', 'integration', 'whatsappWebhookIdempotency.test.js'), 'utf8');

describe('whatsappWebhookIdempotency — orçamento de timeout explícito (T27)', () => {
  it('declara jest.setTimeout compatível com a carga real (>= 30s)', () => {
    const m = SUITE.match(/jest\.setTimeout\((\d+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(30000);
  });
});
