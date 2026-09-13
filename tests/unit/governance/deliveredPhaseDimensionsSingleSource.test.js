'use strict';

/**
 * TAREFA 49/50 — UMA ÚNICA DECLARAÇÃO para as dimensões de fase DELIVERED.
 *
 * Defeito real: a lista `['RAP-055','RAP-056']` existia em QUATRO lugares
 * independentes — `seal-time-gate`, `run-persisted-scorecard`,
 * `master-scorecard-engine` e `verify-delivered-release` — além da declaração
 * canônica em `governance/release-phase-policy.js`. Quatro cópias da mesma
 * política PODEM divergir em silêncio: bastaria alguém classificar uma nova
 * dimensão como dependente da entrega em um só lugar para que o selo e o
 * verificador de entrega passassem a discordar sobre qual dimensão é tolerável.
 *
 * Este arquivo prova DUAS coisas (a segunda é a que importa):
 *
 *   1. IGUALDADE — todos os consumidores usam exatamente o conjunto declarado;
 *   2. DERIVAÇÃO — com a política SUBSTITUÍDA por outra que declara uma
 *      dimensão extra, TODOS os consumidores passam a usá-la. Um literal
 *      hardcoded não passaria neste teste; uma derivação passa.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const POLICY_PATH = path.join(ROOT, 'governance', 'release-phase-policy.js');

const IMPORTABLE_CONSUMERS = [
  ['scripts/governance/seal-time-gate.js', 'DELIVERED_PHASE_DIMS'],
  ['governance/master-scorecard-engine.js', 'DELIVERED_PHASE_DIMENSIONS'],
];

const EXECUTABLE_CONSUMERS = [
  'scripts/governance/run-persisted-scorecard.js',
  'governance/verify-delivered-release.js',
];

function loadConsumerSet(relPath, exportName) {
  const mod = require(path.join(ROOT, relPath));
  const value = mod[exportName];
  if (!value) return null;
  return value instanceof Set ? [...value].sort() : [...new Set(value)].sort();
}

describe('TAREFA 49 — dimensões de fase DELIVERED têm UMA fonte', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock(POLICY_PATH);
  });

  test('a política declara as dimensões e expõe o helper canônico', () => {
    const policy = require('../../../governance/release-phase-policy');
    expect(typeof policy.deliveredPhaseDimensions).toBe('function');
    expect([...policy.deliveredPhaseDimensions()].sort()).toEqual(['RAP-055', 'RAP-056']);
    expect(policy.SCORECARD_DIMENSION_PHASES['RAP-055']).toBe('DELIVERED');
    expect(policy.SCORECARD_DIMENSION_PHASES['RAP-052']).toBe('CANDIDATE_VALIDATED');
  });

  test('RED — os consumers importáveis usam EXATAMENTE o conjunto declarado', () => {
    const declared = [...require('../../../governance/release-phase-policy').deliveredPhaseDimensions()].sort();
    for (const [relPath, exportName] of IMPORTABLE_CONSUMERS) {
      expect({ consumer: relPath, used: loadConsumerSet(relPath, exportName) })
        .toEqual({ consumer: relPath, used: declared });
    }
  });

  test('RED — trocar a POLÍTICA propaga para os consumers importáveis (prova de derivação)', () => {
    // Política substituta: RAP-055/056 continuam DELIVERED e uma dimensão NOVA
    // entra na mesma fase. Um literal hardcoded ignoraria RAP-999 e falharia.
    jest.resetModules();
    jest.doMock(POLICY_PATH, () => {
      const actual = jest.requireActual(POLICY_PATH);
      const withProbe = Object.freeze({ ...actual.SCORECARD_DIMENSION_PHASES, 'RAP-999': 'DELIVERED' });
      return {
        ...actual,
        SCORECARD_DIMENSION_PHASES: withProbe,
        deliveredPhaseDimensions: () => new Set(
          Object.entries(withProbe).filter(([, phase]) => phase === 'DELIVERED').map(([id]) => id),
        ),
      };
    });

    const expected = ['RAP-055', 'RAP-056', 'RAP-999'];
    for (const [relPath, exportName] of IMPORTABLE_CONSUMERS) {
      jest.resetModules();
      expect({ consumer: relPath, used: loadConsumerSet(relPath, exportName) })
        .toEqual({ consumer: relPath, used: expected });
    }
  });

  test('RED — os scripts executáveis NÃO mantêm literal: derivam da política', () => {
    for (const relPath of EXECUTABLE_CONSUMERS) {
      const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
      // Nenhum literal da lista tolerada.
      expect({ file: relPath, literal: /new Set\(\s*\[\s*'RAP-055'/.test(source) })
        .toEqual({ file: relPath, literal: false });
      // E a derivação precisa estar presente (não basta remover o literal).
      expect({ file: relPath, derives: /deliveredPhaseDimensions\(\)/.test(source) })
        .toEqual({ file: relPath, derives: true });
    }
  });
});
