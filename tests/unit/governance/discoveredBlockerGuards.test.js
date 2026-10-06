'use strict';

/**
 * guards dos erros descobertos em 2026-10-05 — cada bloqueio custou um ciclo de
 * selagem; nenhum deles pode depender de alguém lembrar da prosa do commit.
 *
 *   1. ORDEM no gate agregado: os produtores que escrevem relatórios autoritativos
 *      SEM lineage rodam antes do gate temporal; se o `stamp-report-lineage` deixar
 *      de precedê-lo, o gate volta a reprovar com INVALID_AUTHORITATIVE_ARTIFACT.
 *   2. AMBIENTE do coletor de runtime evidence: `ENGINEERING_ROUTER_HOST_REPO_ROOT`
 *      apontando para um não-repo produz 10/25 falhas com o sintoma enganoso
 *      "saída do Jest não pôde ser parseada como JSON".
 *   3. TTL do smoke contínuo: `qa-waves-scheduled-ttl-preflight` é a autoridade única
 *      da avaliação (o `.env` é carregado por ele) e precisa falhar fechado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

describe('gate agregado — ordem do stamp de lineage', () => {
  const chain = () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const raw = String(pkg.scripts['validate:governance-enforcement'] || '');
    return raw.split('&&').map((step) => step.trim());
  };

  test('o agregado estampa o lineage dos derivados ANTES do gate temporal', () => {
    const steps = chain();
    const stampIdx = steps.findIndex((s) => s.includes('stamp-report-lineage.js'));
    const gateIdx = steps.findIndex((s) => s.includes('validate:current-run-temporal-integrity'));
    expect(stampIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(stampIdx).toBeLessThan(gateIdx);
  });

  test('o stamp vem DEPOIS dos produtores que escrevem sem lineage', () => {
    const steps = chain();
    const stampIdx = steps.findIndex((s) => s.includes('stamp-report-lineage.js'));
    // Produtores do próprio agregado que regeneram artefatos autoritativos sem
    // os campos de lineage (medido 2026-10-05: eram exatamente estes seis).
    const producers = [
      'validate:coverage-completeness',
      'validate:visibility-policy',
      'validate:experience-segregation',
      'validate:coverage-gate',
      'audit:json-persistence',
    ];
    for (const producer of producers) {
      const idx = steps.findIndex((s) => s.includes(producer));
      expect({ producer, found: idx >= 0 }).toEqual({ producer, found: true });
      expect(idx).toBeLessThan(stampIdx);
    }
  });
});

describe('coletor de runtime evidence — guard de ambiente', () => {
  const collector = require('../../../scripts/governance/collect-engineering-router-runtime-evidence');
  const previous = process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;

  afterEach(() => {
    if (previous === undefined) delete process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;
    else process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = previous;
  });

  test('reconhece work tree git (repositório real × diretório comum)', () => {
    expect(collector.isGitWorkTree(ROOT)).toBe(true);
    expect(collector.isGitWorkTree(os.tmpdir())).toBe(false);
  });

  test('recusa a variável apontando para um NÃO-repo (causa medida das 10/25 falhas)', () => {
    process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = os.tmpdir();
    expect(collector.assertRouterEnvironmentUsable()).toMatchObject({ ok: false });
  });

  test('sem a variável usa o repositório desta aplicação (default correto)', () => {
    delete process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;
    expect(collector.assertRouterEnvironmentUsable()).toMatchObject({ ok: true, declared: null });
  });
});

describe('TTL do smoke contínuo — autoridade única de avaliação', () => {
  const preflight = require('../../../scripts/governance/qa-waves-scheduled-ttl-preflight');

  test('avalia a evidência REAL e nunca devolve UNAVAILABLE (plumbing saudável)', () => {
    const out = preflight.evaluate(ROOT);
    expect(['OK', 'STALE']).toContain(out.status);
    expect(typeof out.detail).toBe('string');
  });

  test('evidência ausente é UNAVAILABLE (falha fechada, nunca "ok por omissão")', () => {
    const out = preflight.evaluate(path.join(os.tmpdir(), 'ragent2-sem-evidencia'));
    expect(out.status).toBe('UNAVAILABLE');
  });

  test('a fase consolidate do selo reavalia o TTL antes do agregado', () => {
    const seal = fs.readFileSync(path.join(ROOT, 'scripts/governance/seal-release.sh'), 'utf8');
    const consolidate = seal.slice(seal.indexOf('phase_consolidate()'));
    const ttlIdx = consolidate.indexOf('qa-waves-scheduled-ttl-preflight.js');
    const aggregateIdx = consolidate.indexOf('validate:governance-enforcement');
    expect(ttlIdx).toBeGreaterThanOrEqual(0);
    expect(aggregateIdx).toBeGreaterThanOrEqual(0);
    expect(ttlIdx).toBeLessThan(aggregateIdx);
  });
});
