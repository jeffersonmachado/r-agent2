'use strict';

/**
 * Isolamento de cenários de RUNTIME no registry canônico de QA Waves.
 *
 * Defeito fechado (medido 2026-10-04): o fluxo agent-factory cria um agente com
 * slug timestampado a cada execução e registrava o cenário de validação dele
 * (`agent-validation-<slug>`) no registry RASTREADO e GOVERN.ADO
 * `qa/qa-waves/scenario-store.json`. Esse arquivo alimenta o
 * `scenarioRegistryFingerprint` do proof chain, então cada run (inclusive o run
 * canônico do mesh, dentro do ciclo de selagem) sujava a árvore e divergia o
 * fingerprint, abortando o passe `candidate` com o gap CRÍTICO
 * `gap-proof-stale-fingerprints`.
 *
 * Contrato provado aqui:
 *   1. cenário com `nonCanonical: true` NUNCA entra no arquivo canônico;
 *   2. ele VIVE no runtime store (fora do workspace) e continua legível/executável;
 *   3. cenário canônico continua indo (só) para o arquivo canônico;
 *   4. o flag é herdado em upserts posteriores do MESMO id (não vaza para o
 *      canônico no segundo toque);
 *   5. o call site do agent-factory declara a intenção explicitamente.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// As envs precisam existir ANTES do require: STORE_PATH é resolvido no
// carregamento do módulo.
const CANONICAL_STORE_PATH = path.join(os.tmpdir(), `qa-waves-canonical-isolation-${process.pid}.json`);
const RUNTIME_STORE_PATH = path.join(os.tmpdir(), `qa-waves-runtime-isolation-${process.pid}.json`);
process.env.QA_WAVES_SCENARIO_STORE_PATH = CANONICAL_STORE_PATH;
process.env.QA_WAVES_RUNTIME_SCENARIO_STORE_PATH = RUNTIME_STORE_PATH;

jest.mock('../../../api/services/qaMeshService', () => ({
  queueMeshRun: jest.fn(() => ({ executionId: 'mesh-test-isolation' })),
}));

const qaWavesScenarioService = require('../../../api/services/qaWavesScenarioService');

const TENANT_ID = 'system';

/** Shape REAL do fluxo agent-os (agent-hardening-service).
 *
 * Ele NÃO passa por `validateScenarioPayload` — o schema atual rejeita
 * `source: agent-factory` e o step type `validate_capabilities`, então o fluxo
 * cai no `catch` e persiste via `upsertScenarioStore` (que não valida). É
 * exatamente por esse caminho que o resíduo entrava no registry canônico.
 */
function agentFactoryScenario(overrides = {}) {
  return {
    id: 'agent-validation-qa-agent-20261004050506',
    waveId: 'agent-os-qa-agent-20261004050506',
    vertical: 'agent-os',
    journeyId: 'agent-validation-qa-agent-20261004050506',
    name: 'Agent Validation: QA Factory Agent 20261004050506',
    description: 'Validação automatizada do agente qa-agent-20261004050506',
    source: 'agent-factory',
    status: 'approved',
    channels: ['api'],
    risk: 'medium',
    priority: 'high',
    validators: [{ id: 'capabilities_valid', type: 'capability', expected: 'all_present' }],
    steps: [{ id: 'step_001', order: 1, type: 'validate_capabilities', enabled: true }],
    validations: { requireReplay: true, slaMs: 30000 },
    tenantId: TENANT_ID,
    ...overrides,
  };
}

/** Cenário SCHEMA-VÁLIDO (para o caminho `saveScenario`). */
function canonicalScenario(overrides = {}) {
  return {
    id: 'qa-core-config-tenant-intelligence',
    waveId: 'core-config-wave',
    vertical: 'core',
    journeyId: 'core_config_tenant_intelligence',
    name: 'Tenant Intelligence config',
    description: 'Cenário canônico de configuração',
    source: 'manual',
    status: 'approved',
    channels: ['api'],
    risk: 'medium',
    priority: 'high',
    platformScenarioIds: ['qa-core-config-tenant-intelligence'],
    steps: [{ id: 'step_001', order: 1, type: 'validate_intent', enabled: true }],
    validations: { requireReplay: true, slaMs: 30000 },
    tenantId: TENANT_ID,
    ...overrides,
  };
}

function readStore(filePath) {
  if (!fs.existsSync(filePath)) return { scenarios: [], history: {} };
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function scenarioIds(filePath) {
  return readStore(filePath).scenarios.map((item) => item.id);
}

describe('qaWavesScenarioService — cenários de runtime fora do registry canônico', () => {
  beforeEach(() => {
    for (const filePath of [CANONICAL_STORE_PATH, RUNTIME_STORE_PATH]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  afterAll(() => {
    for (const filePath of [CANONICAL_STORE_PATH, RUNTIME_STORE_PATH]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  test('cenário de runtime do agent-factory NÃO entra no canônico (caminho upsert real)', () => {
    qaWavesScenarioService.upsertScenarioStore(agentFactoryScenario(), { nonCanonical: true });

    // Arquivo canônico (governado/rastreado): nenhum cenário de runtime.
    // (`ensureStore` pode criar o arquivo vazio — o invariante é a LISTA.)
    expect(scenarioIds(CANONICAL_STORE_PATH)).toHaveLength(0);
    expect(scenarioIds(CANONICAL_STORE_PATH))
      .not.toContain('agent-validation-qa-agent-20261004050506');

    // Runtime store: contém o cenário.
    expect(scenarioIds(RUNTIME_STORE_PATH)).toContain('agent-validation-qa-agent-20261004050506');
  });

  test('a MESMA intenção é honrada no caminho saveScenario', () => {
    qaWavesScenarioService.saveScenario({
      scenario: canonicalScenario({ id: 'agent-validation-valid-01' }),
      nonCanonical: true,
    });

    expect(scenarioIds(CANONICAL_STORE_PATH)).not.toContain('agent-validation-valid-01');
    expect(scenarioIds(RUNTIME_STORE_PATH)).toContain('agent-validation-valid-01');
  });

  test('cenário de runtime permanece LEGÍVEL (merge) após sair do canônico', () => {
    qaWavesScenarioService.upsertScenarioStore(
      agentFactoryScenario({ id: 'agent-validation-qa-agent-20261004050601' }),
      { nonCanonical: true },
    );

    const listed = qaWavesScenarioService.listLatestScenarios({ tenantId: TENANT_ID });
    expect(listed.items.map((item) => item.id))
      .toContain('agent-validation-qa-agent-20261004050601');
  });

  test('saveScenario canônico escreve APENAS no canônico', () => {
    qaWavesScenarioService.saveScenario({ scenario: canonicalScenario() });

    expect(scenarioIds(CANONICAL_STORE_PATH)).toContain('qa-core-config-tenant-intelligence');
    expect(fs.existsSync(RUNTIME_STORE_PATH)).toBe(false);
  });

  test('cenário de runtime preserva o conteúdo canônico (cenários) inalterado', () => {
    qaWavesScenarioService.saveScenario({
      scenario: canonicalScenario({ id: 'qa-core-config-canonical-stable' }),
    });
    const canonicalBefore = readStore(CANONICAL_STORE_PATH).scenarios;

    qaWavesScenarioService.upsertScenarioStore(
      agentFactoryScenario({ id: 'agent-validation-qa-agent-20261004050701' }),
      { nonCanonical: true },
    );

    const canonicalAfter = readStore(CANONICAL_STORE_PATH).scenarios;
    // O fingerprint do proof usa `version` + `scenarios` projetados: nada aqui
    // pode mudar por causa de um cenário de runtime.
    expect(canonicalAfter).toEqual(canonicalBefore);
  });

  test('o flag de runtime é HERDADO em upserts posteriores do mesmo id', () => {
    const scenario = agentFactoryScenario({ id: 'agent-validation-qa-agent-20261004050801' });
    qaWavesScenarioService.upsertScenarioStore(scenario, { nonCanonical: true });
    expect(scenarioIds(RUNTIME_STORE_PATH)).toContain('agent-validation-qa-agent-20261004050801');

    // Segundo toque SEM a flag explícita: o cenário já é de runtime, então não
    // pode migrar para o arquivo canônico.
    qaWavesScenarioService.upsertScenarioStore({
      ...scenario,
      description: 'Validação automatizada (retoque)',
    });

    expect(scenarioIds(CANONICAL_STORE_PATH))
      .not.toContain('agent-validation-qa-agent-20261004050801');
    const runtimeEntry = readStore(RUNTIME_STORE_PATH).scenarios
      .find((item) => item.id === 'agent-validation-qa-agent-20261004050801');
    expect(runtimeEntry.description).toBe('Validação automatizada (retoque)');
  });

  test('call site do agent-factory declara nonCanonical explicitamente nos DOIS caminhos', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'api', 'modules', 'agent-os', 'services', 'agent-hardening-service.js'),
      'utf8',
    );
    expect(source).toContain('saveScenario({ scenario, nonCanonical: true })');
    expect(source).toContain('upsertScenarioStore(scenario, { nonCanonical: true })');
  });

  test('o registry canonico rastreado nao e alvo de escrita do fluxo de runtime', () => {
    const canonicalTracked = path.join(__dirname, '..', '..', '..', 'qa', 'qa-waves', 'scenario-store.json');
    const before = fs.readFileSync(canonicalTracked, 'utf8');

    qaWavesScenarioService.saveScenario({
      scenario: canonicalScenario({ id: 'agent-validation-valid-02' }),
      nonCanonical: true,
    });

    expect(fs.readFileSync(canonicalTracked, 'utf8')).toBe(before);
  });
});
