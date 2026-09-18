'use strict';

/**
 * Gate 33 (`validate:journey-projections`) — frescor do artefato derivado.
 *
 * Defeito real observado em 2026-09-18 na varredura agregada:
 *   `validate:coverage-gate`/`go-no-go` regeneram `qa-waves/journey-coverage/*.json`
 *   (matéria-prima) DURANTE a varredura; o gate 33 então exigia que
 *   `reports/business-journey-projections.json` (artefato DERIVADO e NÃO
 *   versionado — `.gitignore` → `reports/*`) já estivesse atualizado, falhando
 *   com "Rode: npm run journey:projections". Era uma pré-condição manual oculta:
 *   a mesma varredura mudava a entrada e depois exigia a saída pronta.
 *
 * Correção: regeneração determinística (frescor por CONSTRUÇÃO) + `--strict`
 * preservado como asserção. Estes testes provam os dois sentidos.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'generate-journey-projections.js');
const OUTPUT_PATH = path.join(ROOT, 'reports', 'business-journey-projections.json');

const {
  buildProjections,
  serializeProjections,
  classifyProjectionState,
  computeProjectionDelta,
} = require(SCRIPT);

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
}

describe('classifyProjectionState — decisão pura', () => {
  test('artefato ausente → gera (não é obsolescência)', () => {
    const decision = classifyProjectionState({
      exists: false,
      readable: false,
      current: null,
      expected: 'X',
    });
    expect(decision).toEqual({ action: 'generate', reason: 'artifact_absent' });
  });

  test('artefato ilegível → regenera', () => {
    const decision = classifyProjectionState({
      exists: true,
      readable: false,
      current: '{lixo',
      expected: 'X',
    });
    expect(decision).toEqual({ action: 'regenerate', reason: 'artifact_unreadable' });
  });

  test('artefato divergente → regenera (não falha)', () => {
    const decision = classifyProjectionState({
      exists: true,
      readable: true,
      current: 'A',
      expected: 'B',
    });
    expect(decision).toEqual({ action: 'regenerate', reason: 'input_changed' });
  });

  test('controle negativo: idêntico → mantém, sem escrita', () => {
    const decision = classifyProjectionState({
      exists: true,
      readable: true,
      current: 'A',
      expected: 'A',
    });
    expect(decision).toEqual({ action: 'keep', reason: 'fresh' });
  });
});

describe('computeProjectionDelta — o sinal não pode ser apagado', () => {
  const stage = (id) => ({ id, title: id, description: id });
  const previous = {
    journeys: [
      { vertical: 'fitness', journeyKey: 'agendamento', stages: [stage('s1'), stage('s2')] },
      { vertical: 'food', journeyKey: 'pedido', stages: [stage('s1')] },
    ],
  };
  const next = {
    journeys: [
      { vertical: 'fitness', journeyKey: 'agendamento', stages: [stage('s1')] },
      { vertical: 'beauty', journeyKey: 'reserva', stages: [stage('s1')] },
    ],
  };

  test('detecta jornadas novas, removidas e estágios alterados', () => {
    const delta = computeProjectionDelta(previous, next);
    expect(delta.comparable).toBe(true);
    expect(delta.added).toEqual(['beauty/reserva']);
    expect(delta.removed).toEqual(['food/pedido']);
    expect(delta.stagesChanged).toEqual(['fitness/agendamento (2→1 estágios)']);
  });

  test('artefato anterior ilegível → delta não comparável (não inventa diff)', () => {
    expect(computeProjectionDelta(null, next).comparable).toBe(false);
  });
});

describe('buildProjections — determinismo (regenerar é seguro)', () => {
  test('duas execuções produzem bytes idênticos', () => {
    const first = serializeProjections(buildProjections().artifact);
    const second = serializeProjections(buildProjections().artifact);
    expect(first).toBe(second);
  });
});

describe('gate 33 — integração real do CLI', () => {
  let canonical = null;

  beforeAll(() => {
    canonical = serializeProjections(buildProjections().artifact);
  });

  afterAll(() => {
    // Nunca deixar o workspace com artefato adulterado.
    if (canonical !== null) {
      fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
      fs.writeFileSync(OUTPUT_PATH, canonical);
    }
  });

  function tamper() {
    const tampered = JSON.parse(canonical);
    tampered.journeys = tampered.journeys.slice(0, 1);
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(tampered, null, 2)}\n`);
  }

  test('divergente → regenera deterministicamente e sai 0 (sem pré-condição manual)', () => {
    tamper();
    const result = runCli(['--check']);
    expect(result.status).toBe(0);
    expect(`${result.stdout}`).toMatch(/regeneradas \(input_changed\)/);
    expect(fs.readFileSync(OUTPUT_PATH, 'utf8')).toBe(canonical);
  });

  test('controle negativo: --strict preserva a asserção e falha com divergência', () => {
    tamper();
    const result = runCli(['--check', '--strict']);
    expect(result.status).toBe(1);
    expect(`${result.stderr}`).toMatch(/modo estrito/);
  });

  test('controle negativo: artefato fresco não é reescrito nem reportado como regenerado', () => {
    fs.writeFileSync(OUTPUT_PATH, canonical);
    const result = runCli(['--check']);
    expect(result.status).toBe(0);
    expect(`${result.stdout}`).toMatch(/atualizadas e limpas/);
    expect(`${result.stdout}`).not.toMatch(/regeneradas/);
  });
});
