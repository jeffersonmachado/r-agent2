'use strict';

/**
 * Estabilidade do fingerprint de POLÍTICA contra cache derivada.
 *
 * Defeito real medido (2026-09-18): `config/journey-contracts.json` está em
 * `POLICY_FILES`, mas o gerador reescreve `version`/`generatedAt` e RECALCULA
 * `confidence` (derivada) a cada execução. Consequência:
 *   `npm run qa:business-contracts` → policyFingerprint 5fa01a7c… → 079058b9…
 *   → `create-governed-run` falha com AGENT_POLICY_STALE → o ciclo de selagem
 *     não inicia. E `POLICY_VERSION` é hardcoded: não há caminho de operador.
 * É a MESMA armadilha já documentada para `meshRegistry.json` (artefato derivado
 * rastreado como política = STALE perpétuo).
 *
 * Contrato provado aqui nos DOIS sentidos:
 *  - mexer só em cache/metadados NÃO muda o fingerprint de política;
 *  - mexer em política DECLARADA (requiredCapabilities) MUDA.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  computePolicyFingerprint,
  POLICY_FILES,
} = require('../../../governance/proof-engine/fingerprint-chain');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONTRACTS_REL = 'config/journey-contracts.json';

/** Monta um root temporário com os POLICY_FILES reais e devolve um mutador. */
function buildTempRoot(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-fp-'));
  for (const rel of POLICY_FILES) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  if (mutate) {
    const target = path.join(dir, CONTRACTS_REL);
    const doc = JSON.parse(fs.readFileSync(target, 'utf8'));
    fs.writeFileSync(target, `${JSON.stringify(mutate(doc), null, 2)}\n`);
  }
  return dir;
}

function withTempRoots(mutateA, mutateB, assertion) {
  const rootA = buildTempRoot(mutateA);
  const rootB = buildTempRoot(mutateB);
  try {
    return assertion(computePolicyFingerprint(rootA), computePolicyFingerprint(rootB));
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
}

describe('fingerprint de política — cache derivada não pode invalidar a política', () => {
  test('recálculo de confidence + bump de version/generatedAt NÃO muda o fingerprint', () => {
    const [a, b] = [
      (doc) => doc,
      (doc) => {
        for (const contract of Object.values(doc.journeys || {})) {
          contract.confidence = 0.99; // cache derivada
        }
        doc.version = (doc.version || 1) + 7;
        doc.generatedAt = '2030-01-01T00:00:00.000Z';
        return doc;
      },
    ];

    withTempRoots(a, b, (fpA, fpB) => {
      expect(fpB).toBe(fpA);
    });
  });

  test('controle negativo: mudar POLÍTICA DECLARADA muda o fingerprint', () => {
    const [a, b] = [
      (doc) => doc,
      (doc) => {
        const firstId = Object.keys(doc.journeys)[0];
        doc.journeys[firstId].requiredCapabilities = ['capability_intrusa'];
        return doc;
      },
    ];

    withTempRoots(a, b, (fpA, fpB) => {
      expect(fpB).not.toBe(fpA);
    });
  });

  test('controle negativo: remover uma capability declarada também muda', () => {
    const [a, b] = [
      (doc) => doc,
      (doc) => {
        const entry = Object.entries(doc.journeys).find(([, c]) => (c.requiredCapabilities || []).length > 0);
        entry[1].requiredCapabilities = [];
        return doc;
      },
    ];

    withTempRoots(a, b, (fpA, fpB) => {
      expect(fpB).not.toBe(fpA);
    });
  });

  test('política ilegível na projeção falha EXPLÍCITA (fail-closed, sem hash cru em silêncio)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-fp-bad-'));
    try {
      for (const rel of POLICY_FILES) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
      }
      fs.writeFileSync(path.join(dir, CONTRACTS_REL), '{ isto nao e json');
      expect(() => computePolicyFingerprint(dir)).toThrow(/policy_projection_failed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
