/**
 * FlowInferencer — Port do FlowInferencer do Replay2 (Python → JavaScript)
 *
 * Dado um grafo de entidades e relacionamentos, infere:
 *  - Regras de negócio (arestas A→B viram "A exige B")
 *  - Fluxos de negócio (componentes conectados ordenados topologicamente)
 */

/**
 * Encontra raízes (entidades sem dependências de entrada) e folhas
 * (entidades sem dependentes).
 */
function findRootsAndLeaves(entityGraph, entityNames) {
  const hasIncoming = new Set();
  const hasOutgoing = new Set();

  for (const [from, deps] of Object.entries(entityGraph)) {
    if (deps.length > 0) hasOutgoing.add(from);
    for (const to of deps) {
      hasIncoming.add(to);
    }
  }

  const roots = entityNames.filter((e) => !hasIncoming.has(e));
  const leaves = entityNames.filter((e) => !hasOutgoing.has(e) && entityGraph[e]?.length === 0);

  // Se não encontrou raízes naturais (grafo cíclico ou todo mundo tem dependência),
  // usa a primeira entidade como raiz
  if (roots.length === 0 && entityNames.length > 0) {
    roots.push(entityNames[0]);
  }

  return { roots, leaves };
}

/**
 * Gera regras a partir das arestas do grafo.
 * Cada aresta A→B vira: "A exige B cadastrado"
 */
function generateRules(entityGraph) {
  const rules = [];
  let idx = 1;

  for (const [from, deps] of Object.entries(entityGraph)) {
    for (const to of deps) {
      rules.push({
        ruleId: `rule-${String(idx).padStart(3, '0')}`,
        description: `${from} exige ${to} cadastrado`,
        dependsOn: to,
        enables: from,
        dependencyType: 'requires',
        isCritical: true
      });
      idx++;
    }
  }

  return rules;
}

/**
 * Encontra componentes conectados no grafo não-direcionado usando BFS.
 */
function findConnectedComponents(entityGraph, entityNames) {
  const adjacency = {};

  // Constrói grafo não-direcionado
  for (const name of entityNames) {
    adjacency[name] = new Set();
  }

  for (const [from, deps] of Object.entries(entityGraph)) {
    for (const to of deps) {
      if (adjacency[from]) adjacency[from].add(to);
      if (adjacency[to]) adjacency[to].add(from);
    }
  }

  const visited = new Set();
  const components = [];

  for (const name of entityNames) {
    if (visited.has(name)) continue;

    const component = [];
    const queue = [name];
    visited.add(name);

    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);

      for (const neighbor of adjacency[current] || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * Ordenação topológica usando algoritmo de Kahn.
 * Retorna array ordenado ou fallback com a ordem original se houver ciclo.
 */
function topologicalSortComponent(componentEntities, entityGraph) {
  const inDegree = {};
  const adjacency = {};

  for (const entity of componentEntities) {
    inDegree[entity] = 0;
    adjacency[entity] = [];
  }

  for (const [from, deps] of Object.entries(entityGraph)) {
    if (!componentEntities.includes(from)) continue;
    for (const to of deps) {
      if (!componentEntities.includes(to)) continue;
      adjacency[from].push(to);
      inDegree[to] = (inDegree[to] || 0) + 1;
    }
  }

  const queue = [];
  for (const entity of componentEntities) {
    if (inDegree[entity] === 0) {
      queue.push(entity);
    }
  }

  const sorted = [];

  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);

    for (const neighbor of adjacency[current] || []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Fallback: se há ciclo, retorna as entidades na ordem original
  if (sorted.length < componentEntities.length) {
    return componentEntities;
  }

  return sorted;
}

/**
 * Gera fluxos a partir dos componentes conectados.
 * Cada componente vira um fluxo com passos ordenados topologicamente.
 */
function generateFlows(entityGraph, entityNames, entities) {
  const components = findConnectedComponents(entityGraph, entityNames);
  const flows = [];

  for (const component of components) {
    if (component.length === 0) continue;

    const sorted = topologicalSortComponent(component, entityGraph);
    const entityMap = new Map(entities.map((e) => [e.name, e]));

    const steps = sorted.map((entityName, idx) => {
      const deps = entityGraph[entityName] || [];
      const why = deps.length > 0
        ? `Exige: ${deps.join(', ')}`
        : idx === 0
          ? 'Entidade raiz — não depende de outras'
          : 'Etapa do fluxo';

      return {
        entity: entityName,
        operation: `manter_${entityName.toLowerCase()}`,
        why
      };
    });

    const flowId = `flow-${component[0].toLowerCase()}`;
    const flowName = sorted.join(' → ');

    flows.push({
      flowId,
      flowName,
      description: `Fluxo com ${sorted.length} entidades: da raiz "${sorted[0]}" ate a folha "${sorted[sorted.length - 1]}"`,
      steps,
      entitiesInFlow: [...sorted],
      coverage: 0,
      coveredEntities: 0,
      totalEntities: sorted.length
    });
  }

  return flows;
}

/**
 * Interface principal — infer(entities, relationships) → { rules, flows }
 *
 * @param {Array<{name: string, fields?: string[]}>} entities
 * @param {Array<{from: string, to: string}>} relationships
 * @returns {{ rules: Array, flows: Array }}
 */
export function infer(entities, relationships) {
  const entityNames = entities.map((e) => e.name);

  // Constrói grafo direcionado: from → [to1, to2, ...]
  const entityGraph = {};
  for (const name of entityNames) {
    entityGraph[name] = [];
  }

  for (const rel of relationships) {
    if (!entityGraph[rel.from]) entityGraph[rel.from] = [];
    entityGraph[rel.from].push(rel.to);
    // Garante que o 'to' existe no grafo mesmo sem arestas de saída
    if (!entityGraph[rel.to]) entityGraph[rel.to] = [];
  }

  const rules = generateRules(entityGraph);
  const flows = generateFlows(entityGraph, entityNames, entities);

  return { rules, flows, entityGraph };
}

export default { infer, findRootsAndLeaves, findConnectedComponents, topologicalSortComponent };
