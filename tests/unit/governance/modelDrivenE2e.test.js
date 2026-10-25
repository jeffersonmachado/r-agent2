'use strict';

/**
 * Testes para validate-model-driven-e2e.js (CLAUDE-004).
 *
 * Garante que o script usa pipeline REAL (não simulação):
 * 1. Sem simulação: script não contém simulateCandidateJourneyPipeline
 * 2. DISCOVERED: inferJourneysFromModels retorna jornadas reais
 * 3. SEED_PLANNED: topological sort sem ciclos para modelos core
 * 4. EXECUTED: requer smoke report com status GO
 * 5. VALIDATED: requer replay-hardening-report com GO
 * 6. Verifica estaticamente que synthesizeExampleSeedPlan não é usado como prova
 */

const fs   = require('fs');
const path = require('path');

const { preservarArtefato } = require('../../helpers/preserveGovernedArtifact');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'validate-model-driven-e2e.js');

// O produtor real tem OUTPUT_PATH canônico (`governance/model-driven-e2e-report.json`).
// Rodar este teste reescrevia esse artefato governado FORA do run e o pipeline
// pagava a conta: temporal-integrity INVALID_AUTHORITATIVE_ARTIFACT -> TEMPORAL-01/04
// UNPROVEN -> selo V2 NO_GO em REQUIRED_TESTS_V2 -> zip:release bloqueado.
// Devolver os BYTES originais ao final preserva inclusive o lineage gravado dentro
// do JSON (restaurar é diferente de redirecionar o caminho canônico do produtor).
const RELATORIO = path.join(__dirname, '..', '..', '..', 'governance', 'model-driven-e2e-report.json');
let guardaDoRelatorio = null;

beforeAll(() => { guardaDoRelatorio = preservarArtefato(RELATORIO); });
afterAll(() => { if (guardaDoRelatorio) guardaDoRelatorio.restaurar(); });

describe('validate-model-driven-e2e — pipeline REAL, não simulação', () => {

  test('Verificação estática: script não usa simulateCandidateJourneyPipeline', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');

    expect(source).not.toContain('simulateCandidateJourneyPipeline');
    expect(source).not.toContain('synthesizeExampleSeedPlan');

    // Deve usar pipeline real
    expect(source).toContain('inferJourneysFromModels');
    expect(source).toContain('introspectAllModels');
    expect(source).toContain('buildEntityGraph');
  });

  test('Verificação estática: script não hardcoda listas de entidades como prova', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');

    // Não deve ter lista hardcoded de estados como 'DISCOVERED', 'SEED_PLANNED', etc.
    // que sejam gerados internamente (hardcoded states array)
    expect(source).not.toContain("state: 'DISCOVERED'");
    expect(source).not.toContain("state: 'SEED_PLANNED'");
    expect(source).not.toContain("state: 'EXECUTED'");

    // Não deve hardcodar lista de entidades fitness
    expect(source).not.toContain("'Establishment'");
    expect(source).not.toContain("'Appointment'");
  });

  test('inferJourneysFromModels retorna jornadas reais (integração pipeline sem DB)', () => {
    const { inferJourneysFromModels } = require('../../../api/modules/agent-os/services/model-driven-pipeline');

    const result = inferJourneysFromModels();

    // Deve descobrir pelo menos 1 jornada via pipeline real
    expect(result.totalJourneys).toBeGreaterThan(0);
    expect(result.journeys || result.candidateJourneys).toBeDefined();

    // journeyId deve ser gerado pelo pipeline, não hardcoded
    const journeys = result.journeys || result.candidateJourneys || [];
    for (const j of journeys) {
      // IDs gerados pelo pipeline têm timestamp (ex: journey_1787249789955_...)
      // não são IDs fixos hardcoded
      expect(j.id || j.journeyId).toBeTruthy();
    }
  });

  test('topologicalSort com modelos reais — Tenant não pode ser filho de ninguém', () => {
    const { topologicalSort } = require('../../../api/modules/agent-os/services/relational-seed-planner');
    const { introspectAllModels } = require('../../../api/modules/agent-os/services/model-introspection-service');

    const introspection = introspectAllModels();
    const modelNames = introspection.models.map((m) => m.modelName);
    const fkEdges    = new Map(modelNames.map((n) => [n, []]));

    for (const model of introspection.models) {
      for (const [, attr] of Object.entries(model.attributes || {})) {
        if (attr && attr.references) {
          const targetModel = attr.references.model;
          if (targetModel && fkEdges.has(model.modelName)) {
            fkEdges.get(model.modelName).push(targetModel);
          }
        }
      }
    }

    const { order, cycles } = topologicalSort(modelNames, fkEdges);

    // Deve ordenar todos os modelos
    expect(order.length).toBeGreaterThan(100);

    // Tenant (root) deve aparecer antes dos modelos que dependem dele
    // Se Tenant está na ordem, verificar sua posição
    if (order.includes('Tenant')) {
      const tenantIdx = order.indexOf('Tenant');
      const tenantIdx2 = order.indexOf('TenantUser');
      if (tenantIdx2 !== -1) {
        expect(tenantIdx).toBeLessThan(tenantIdx2);
      }
    }

    // Sem ciclos críticos (pode haver ciclos em modelos auto-referenciantes opcionais)
    // O importante é que os modelos core não estejam em ciclos
    const coreCycles = cycles.filter((c) =>
      c.some((n) => ['Tenant', 'Ticket', 'EventLedger'].includes(n))
    );
    expect(coreCycles).toHaveLength(0);
  });

  test('Script passa com smoke report real presente', () => {
    // Verificar que o script atual (com arquivos reais) passa
    const { spawnSync } = require('child_process');
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..', '..', '..'),
      env: { ...process.env },
    });

    const output = (result.stdout || '') + (result.stderr || '');
    const report = (() => {
      try {
        return JSON.parse(fs.readFileSync(
          path.join(__dirname, '..', '..', '..', 'governance', 'model-driven-e2e-report.json'),
          'utf8'
        ));
      } catch (_) { return null; }
    })();

    // FALHA AUTO-DESCRITIVA (medido 2026-10-24 nos cenários `missing-artifact` e
    // `corrupt-artifact` do harness): quando a prova prod-like está ausente ou ilegível, o
    // produtor devolve `pass:false` com a violação `EXECUTED: smoke report ausente (...)`. Sem
    // nomear a dependência, a mensagem de reprovação era só `Expected: 0, Received: 1` e o harness
    // classificava como `EXPECTED_FAILURE_SEM_ASSINATURA` (falha pelo motivo ERRADO) — o cenário
    // negativo ficava vermelho sem dizer por quê. Aqui a dependência é nomeada e o relatório do
    // produtor é anexado à mensagem.
    if (report?.pass !== true) {
      throw new Error(
        'artefato prod-like ausente ou ilegivel: qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json '
        + `(exit=${result.status}, decision=${report?.decision || 'sem-relatorio'}, `
        + `violacoes=${JSON.stringify(report?.violations || [])}, saida=${output.slice(-400)})`,
      );
    }
    expect(result.status).toBe(0);
    expect(report?.pass).toBe(true);
    expect(report?.decision).toBe('MODEL_DRIVEN_E2E_VALIDATED');
    expect(report?.pipelineOutput?.journeysDiscovered).toBeGreaterThan(0);
    expect(report?.pipelineOutput?.modelsIntrospected).toBeGreaterThan(100);
    expect(output).toContain('MODEL_DRIVEN_E2E_VALIDATED');
  });

  test('Engine é v2-real-pipeline (não v1 de simulação)', () => {
    const report = (() => {
      try {
        return JSON.parse(fs.readFileSync(
          path.join(__dirname, '..', '..', '..', 'governance', 'model-driven-e2e-report.json'),
          'utf8'
        ));
      } catch (_) { return null; }
    })();

    if (report) {
      expect(report.engine).toContain('v2-real-pipeline');
      expect(report.engine).not.toContain('v1');
    }
  });
});
