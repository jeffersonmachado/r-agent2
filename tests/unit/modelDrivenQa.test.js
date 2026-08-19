'use strict';

/**
 * FASES 13-14 — Model-driven QA real.
 *
 * Falhas cobertas (falhariam antes da correção):
 * 1. FK era detectada por sufixo `_id` — campo `owner` com references real
 *    era ignorado e `xyz_id` sem references era falso-positivo. Agora FK
 *    exige metadata real (attrMeta.references ou associação BelongsTo).
 * 2. inferJourneys ignorava o entityGraph — só templates hard-coded geravam
 *    jornadas. Agora componentes conectados por FK sem jornada registrada
 *    geram journey candidata + sinal 'behavior_without_registered_journey'.
 * 3. agentFactoryUsesModelDrivenJourneys era literal `true` auto-atestado.
 *    Agora deriva de verificação real (consumidor existe e é invocado).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const introspectionService = require('../../api/modules/agent-os/services/model-introspection-service');
const {
  buildEntityGraph,
  inferJourneys,
  verifyAgentFactoryModelDrivenIntegration,
} = require('../../api/modules/agent-os/services/model-driven-pipeline');

// ─── 1. FK por metadata real, nunca por sufixo ───────────────────────────────

describe('model-introspection-service — FK via metadata real do Sequelize', () => {
  test('campo `owner` com references É FK; campo `xyz_id` sem references NÃO é', () => {
    const fks = introspectionService.detectForeignKeyFields({
      id: { type: 'UUID', primaryKey: true },
      owner: { type: 'UUID', allowNull: false, references: { model: 'users', key: 'id' } },
      xyz_id: { type: 'UUID', allowNull: true },
      tenant_id: { type: 'STRING', allowNull: false },
    }, ['id']);

    expect(fks.owner).toBeDefined();
    expect(fks.owner.referencedModel).toBe('users');
    expect(fks.owner.source).toBe('sequelize_references');
    expect(fks.xyz_id).toBeUndefined();
    expect(fks.tenant_id).toBeUndefined();
  });

  test('associação BelongsTo real conta como FK mesmo sem references no atributo', () => {
    const fakeModel = {
      associations: {
        Author: {
          associationType: 'BelongsTo',
          foreignKey: { fieldName: 'authorRef' },
          target: { name: 'Author' },
        },
        Tags: {
          associationType: 'BelongsToMany',
          foreignKey: 'postId',
          target: { name: 'Tag' },
        },
      },
    };
    const assocFks = introspectionService.extractAssociationForeignKeys(fakeModel);
    expect(assocFks).toEqual([{ fkField: 'authorRef', referencedModel: 'Author', as: null }]);

    const fks = introspectionService.detectForeignKeyFields(
      { authorRef: { type: 'INTEGER', allowNull: false } },
      [],
      assocFks,
    );
    expect(fks.authorRef.source).toBe('sequelize_association');
  });

  test('source-parse extrai FK camelCase via references (model real KnowledgeGraphEdge)', () => {
    const meta = introspectionService.introspectModelFromSource(
      path.resolve(__dirname, '../../api/db/models/KnowledgeGraphEdge.js'),
      'KnowledgeGraphEdge',
    );
    // sourceNodeId/targetNodeId são FKs reais (references) mas NÃO terminam em _id
    expect(meta.foreignKeys.sourceNodeId).toBeDefined();
    expect(meta.foreignKeys.sourceNodeId.referencedModel).toBe('kg_nodes');
    expect(meta.foreignKeys.targetNodeId).toBeDefined();
    // tenant_id não declara references → não é FK (antes era falso-positivo)
    expect(meta.foreignKeys.tenant_id).toBeUndefined();
  });

  test('source-parse de fixture: references inline vira FK, sufixo sozinho não', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-model-'));
    const modelPath = path.join(dir, 'Widget.js');
    fs.writeFileSync(modelPath, `'use strict';
module.exports = function getWidgetModel() {};
// sequelize.define('Widget', {
//   id: { type: DataTypes.UUID, primaryKey: true },
//   owner: { type: DataTypes.UUID, allowNull: false, references: { model: 'w5_owners', key: 'id' } },
//   legacy_id: { type: DataTypes.UUID, allowNull: true },
// }, { tableName: 'w5_widgets' });
`);
    const meta = introspectionService.introspectModelFromSource(modelPath, 'Widget');
    expect(meta.foreignKeys.owner).toBeDefined();
    expect(meta.foreignKeys.owner.referencedTable).toBe('w5_owners');
    expect(meta.foreignKeys.legacy_id).toBeUndefined();
  });
});

// ─── 2. inferJourneys consome o entityGraph (FKs) ────────────────────────────

function makeIntrospection(models) {
  return { models };
}

function makeModel(modelName, tableName, foreignKeys = {}) {
  return {
    modelName,
    tableName,
    attributes: {},
    primaryKeys: ['id'],
    foreignKeys,
    totalAttributes: 2,
    totalRequired: 1,
  };
}

describe('model-driven-pipeline — inferência de jornadas via entity graph (FK)', () => {
  const domainMap = { domains: [] };

  test('models novos conectados por FK geram journey candidata + sinal de comportamento sem jornada', () => {
    // W5Foo.owner referencia a TABELA w5_bars (tableName do model W5Bar)
    const introspection = makeIntrospection([
      makeModel('W5Foo', 'w5_foos', {
        owner: { referencedModel: 'w5_bars', referencedTable: 'w5_bars', referencedKey: 'id', allowNull: false, source: 'sequelize_references' },
      }),
      makeModel('W5Bar', 'w5_bars'),
    ]);
    const entityGraph = buildEntityGraph(introspection, domainMap);

    // edge FK resolvida por tableName (references.model era 'w5_bars')
    const fkEdges = entityGraph.edges.filter(e => e.relationship !== 'same_domain');
    expect(fkEdges).toHaveLength(1);
    expect(fkEdges[0].source).toBe('W5Foo');
    expect(fkEdges[0].target).toBe('W5Bar');

    const result = inferJourneys(introspection, domainMap, entityGraph);

    // Nenhum template cobre W5Foo/W5Bar → templates não geram jornada
    expect(result.totalJourneys).toBe(0);
    // …mas o entity graph gera journey candidata via FK
    expect(result.entityGraphConsumed).toBe(true);
    expect(result.candidateJourneys).toHaveLength(1);
    const candidate = result.candidateJourneys[0];
    expect(candidate.source).toBe('entity_graph_fk');
    expect(candidate.inferredFromFk).toBe(true);
    expect(candidate.status).toBe('candidate');
    expect(candidate.sourceModels).toEqual(['W5Bar', 'W5Foo']);
    expect(candidate.entrypoints).toEqual(['W5Foo']); // detentor da FK, sem aresta de entrada

    // sinal explícito de comportamento sem jornada registrada
    expect(result.uncoveredBehaviors).toHaveLength(2);
    expect(result.uncoveredBehaviors.every(b => b.signal === 'behavior_without_registered_journey')).toBe(true);
  });

  test('sem edge FK não há candidata — prova que a inferência vem do grafo, não da presença', () => {
    const introspection = makeIntrospection([
      makeModel('W5Foo', 'w5_foos'),
      makeModel('W5Bar', 'w5_bars'),
    ]);
    const entityGraph = buildEntityGraph(introspection, domainMap);
    const result = inferJourneys(introspection, domainMap, entityGraph);
    expect(result.candidateJourneys).toHaveLength(0);
    expect(result.uncoveredBehaviors).toHaveLength(0);
  });

  test('componente FK totalmente coberto por template não gera sinal', () => {
    // Ticket e ChannelConversation fazem parte do template 'Omnichannel Attendance'
    const introspection = makeIntrospection([
      makeModel('Ticket', 'tickets', {
        conversation: { referencedModel: 'ChannelConversation', referencedTable: null, referencedKey: 'id', allowNull: true, source: 'sequelize_references' },
      }),
      makeModel('ChannelConversation', 'channel_conversations'),
    ]);
    const entityGraph = buildEntityGraph(introspection, domainMap);
    const result = inferJourneys(introspection, domainMap, entityGraph);
    const templateJourney = result.journeys.find(j => j.name === 'Omnichannel Attendance');
    expect(templateJourney).toBeDefined();
    expect(result.uncoveredBehaviors.filter(b => b.model === 'Ticket' || b.model === 'ChannelConversation')).toHaveLength(0);
  });
});

// ─── 3. Flag de integração derivado de verificação real ─────────────────────

describe('run-model-driven-pipeline — agentFactoryUsesModelDrivenJourneys real', () => {
  test('consumidor real existe e é invocado → used=true com evidência', () => {
    const journeysReport = { totalJourneys: 3, journeys: [{ id: 'j1', name: 'Agent Validation', domain: 'Agent OS', completeness: 1 }] };
    const result = verifyAgentFactoryModelDrivenIntegration(journeysReport);
    expect(result.used).toBe(true);
    expect(result.evidence.reason).toBe('consumer_invoked');
    expect(result.evidence.probe.source).toBe('model-driven-pipeline.inferJourneys');
    expect(result.evidence.probe.totalJourneys).toBe(3);
  });

  test('relatório injetado é ecoado na sonda (derivação real, não literal)', () => {
    const journeysReport = { totalJourneys: 999, journeys: [] };
    const result = verifyAgentFactoryModelDrivenIntegration(journeysReport);
    // O resolvedor real reporta totalJourneys do relatório injetado — 999 é
    // injetado e deve ser ecoado; um relatório nulo forçaria recálculo real.
    expect(result.evidence.probe.totalJourneys).toBe(999);
    expect(result.used).toBe(true);
  });

  test('consumidor sem o resolvedor → used=false com evidência consumer_missing', () => {
    jest.isolateModules(() => {
      jest.doMock('../../api/modules/agent-os/services/agent-hardening-service', () => ({}));
      const { verifyAgentFactoryModelDrivenIntegration: verify } = require('../../api/modules/agent-os/services/model-driven-pipeline');
      const result = verify({ totalJourneys: 1, journeys: [] });
      expect(result.used).toBe(false);
      expect(result.evidence.reason).toBe('consumer_missing');
      jest.dontMock('../../api/modules/agent-os/services/agent-hardening-service');
    });
  });

  test('resolvedor real deriva relatedJourneys do relatório injetado', () => {
    const hardeningService = require('../../api/modules/agent-os/services/agent-hardening-service');
    const report = {
      totalJourneys: 2,
      journeys: [
        { id: 'j1', name: 'Agent Validation', domain: 'Agent OS', completeness: 1 },
        { id: 'j2', name: 'Order & Delivery', domain: 'Food / Delivery', completeness: 1 },
      ],
    };
    const resolved = hardeningService.resolveModelDrivenJourneysForValidation({
      agent: { slug: 'a1', name: 'A1', domain: 'Agent OS' },
      journeysReport: report,
    });
    expect(resolved.source).toBe('model-driven-pipeline.inferJourneys');
    expect(resolved.totalJourneys).toBe(2);
    expect(resolved.relatedJourneys.map(j => j.name)).toContain('Agent Validation');
  });
});
