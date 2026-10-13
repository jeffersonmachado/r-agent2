'use strict';

/**
 * Orçamento de conexões do PostgreSQL (Fase 10).
 *
 * PROBLEMA REAL: cada workload dimensiona o próprio pool isoladamente e nenhum enxerga
 * os outros — a soma teórica dos máximos passa de `max_connections` e o estouro
 * aparece como erro VAZIO do Sequelize (já confundido com "suíte instável").
 *
 * E um defeito de OBSERVABILIDADE medido em 2026-10-11 ao escrever este gate: todas as
 * conexões chegavam com `application_name` VAZIO e usuário `postgres` — era impossível
 * atribuir consumo a um workload, então qualquer orçamento por classe seria ficção.
 * Foi corrigido na fonte (`api/db/sequelize.js` declara `application_name=rap-api`,
 * sobrescrevível por `PGAPPNAME`).
 *
 * Estes testes travam: (a) a classificação por identidade declarada, (b) a invariante
 * dos cenários (o orçamento declarado tem de caber no teto útil), (c) a política
 * versionada usada em produção não pode estar fora da invariante.
 */

const path = require('path');

const {
  classifyConnection,
  checkScenarioInvariant,
  loadPolicy,
} = require('../../../scripts/governance/check-postgres-budget');

describe('classifyConnection — consumo precisa ser atribuível', () => {
  it('reconhece cada workload pela identidade DECLARADA', () => {
    expect(classifyConnection({ applicationName: 'rap-api' })).toBe('api');
    expect(classifyConnection({ applicationName: 'rap-engineering-runner' })).toBe('engineering_runner');
    expect(classifyConnection({ applicationName: 'rap-jest-authoritative' })).toBe('jest_authoritative');
    expect(classifyConnection({ applicationName: 'rap-qa-mesh' })).toBe('qa_mesh');
    expect(classifyConnection({ applicationName: 'rag-service' })).toBe('rag_service');
    expect(classifyConnection({ applicationName: 'rap-tools' })).toBe('tools');
  });

  it('conexão SEM identificação não recebe classe inventada', () => {
    // Medido: as conexões chegavam com application_name vazio e usuário `postgres`.
    // Chutar `api` ou `tools` esconderia consumo — o relatório precisa mostrar o que
    // ficou sem atribuição.
    expect(classifyConnection({ applicationName: '', userName: 'postgres' })).toBe('unattributed');
    expect(classifyConnection({})).toBe('unattributed');
    expect(classifyConnection({ applicationName: 'algo-desconhecido' })).toBe('unattributed');
  });

  it('usuário python sem application_name é RAG (pista fraca, mas inequívoca)', () => {
    expect(classifyConnection({ applicationName: '', userName: 'uvicorn' })).toBe('rag_service');
  });

  it('a identidade declarada vence a pista do usuário', () => {
    expect(classifyConnection({ applicationName: 'rap-api', userName: 'postgres' })).toBe('api');
  });
});

describe('checkScenarioInvariant — orçamento é declaração, não desejo', () => {
  const base = {
    database: { maxConnections: 100, superuserReservedConnections: 3, safetyMargin: 10 },
    classes: {
      api: { max: 40 },
      jest_authoritative: { max: 20 },
      rag_service: { max: 10 },
      tools: { max: 5 },
    },
  };

  it('cenário que cabe na soma exata é aceito (teto útil = 87)', () => {
    const r = checkScenarioInvariant({
      ...base,
      scenarios: { dev_local: { simultaneous: ['api', 'rag_service', 'tools'], max: 55 } },
    });
    expect(r.usefullCeiling).toBe(87);
    expect(r.violations).toEqual([]);
  });

  it('cenário cuja soma das classes estoura o teto útil é OVER_BUDGET', () => {
    const r = checkScenarioInvariant({
      ...base,
      scenarios: { apertado: { simultaneous: ['api', 'jest_authoritative', 'rag_service', 'tools'], max: 75 } },
    });
    // 40+20+10+5 = 75 <= 87 ⇒ cabe; agora forçamos estouro declarando classes maiores.
    expect(r.violations).toEqual([]);

    const estourado = checkScenarioInvariant({
      database: { maxConnections: 60, superuserReservedConnections: 3, safetyMargin: 10 },
      classes: base.classes,
      scenarios: { apertado: { simultaneous: ['api', 'jest_authoritative', 'rag_service', 'tools'], max: 75 } },
    });
    expect(estourado.violations.map((v) => v.code)).toContain('SCENARIO_OVER_BUDGET');
  });

  it('`max` do cenário que NÃO é a soma das classes é inconsistência declarada', () => {
    const r = checkScenarioInvariant({
      ...base,
      scenarios: { dev_local: { simultaneous: ['api', 'rag_service', 'tools'], max: 999 } },
    });
    expect(r.violations.map((v) => v.code)).toContain('SCENARIO_MAX_INCONSISTENT');
  });

  it('cenário vazio não inventa violação', () => {
    const r = checkScenarioInvariant({ ...base, scenarios: {} });
    expect(r.violations).toEqual([]);
  });
});

describe('política versionada em uso (config/postgres-budget.json)', () => {
  const policy = loadPolicy();

  it('existe e é versionada', () => {
    expect(policy).not.toBeNull();
    expect(typeof policy.version).toBe('string');
    expect(policy.policyId).toBe('POSTGRES-CONNECTION-BUDGET');
  });

  it('TODOS os cenários declarados cabem no teto útil (invariante do repositório)', () => {
    const { violations } = checkScenarioInvariant(policy);
    expect(violations).toEqual([]);
  });

  it('não aumenta `max_connections` e declara a regra de PgBouncer', () => {
    expect(policy.database.maxConnections).toBe(100);
    expect(policy.invariants.neverRaiseMaxConnectionsBlindly).toMatch(/PgBouncer/);
  });

  it('as classes e cenários citam-se mutuamente (nenhuma classe órfã no cenário)', () => {
    for (const cenario of Object.values(policy.scenarios)) {
      for (const classe of cenario.simultaneous) {
        expect(Object.prototype.hasOwnProperty.call(policy.classes, classe)).toBe(true);
      }
    }
  });

  it('a API declara identidade de conexão na fonte (senão nada disto é mensurável)', () => {
    const fs = require('fs');
    const fonte = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'api', 'db', 'sequelize.js'), 'utf8');
    expect(fonte).toContain('application_name');
    expect(fonte).toContain('PGAPPNAME');
  });
});
