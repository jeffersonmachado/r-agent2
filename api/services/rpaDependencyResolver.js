/**
 * Resolvedor de Dependências RPA
 * 
 * Responsabilidades:
 * - Analisa fluxos e identifica TODAS as dependências necessárias
 * - Verifica se dependências já existem no sistema
 * - Mapeia dependências faltantes para ações RPA (seeds)
 * - Garante que nenhuma gravação RPA seja criada sem dependências satisfeitas
 * 
 * Tipos de dependências cobertas:
 * - Cadastros estruturais (departamentos, filas, agentes, usuários, papéis, canais)
 * - Dependências de fluxo (fluxos referenciados, versões, nós obrigatórios)
 * - Dependências de RAG (bases de conhecimento, documentos, índices)
 * - Dependências de configuração (integrações, flags, modelos de IA)
 * - Dependências de teste (usuário de teste, ambiente autenticado, permissões)
 */

const logger = require('../utils/logger');
const departmentsService = require('./departmentsService');
const queueService = require('./queueService');
const authService = require('./authService');
const ragDocumentsService = require('./ragDocumentsService');
const ragService = require('./ragService');
const config = require('../utils/config');

/**
 * @typedef {Object} Dependency
 * @property {string} type - Tipo da dependência (department, queue, agent, rag_base, etc)
 * @property {string} identifier - Identificador da dependência (nome, ID, etc)
 * @property {boolean} exists - Se a dependência já existe
 * @property {Object|null} existingData - Dados da dependência existente (se exists = true)
 * @property {string|null} rpaSeedName - Nome do seed RPA para criar (se exists = false)
 * @property {Object} metadata - Metadados adicionais
 */

/**
 * @typedef {Object} DependencyResolutionResult
 * @property {boolean} allSatisfied - Se todas as dependências estão satisfeitas
 * @property {Dependency[]} dependencies - Lista de todas as dependências detectadas
 * @property {Dependency[]} missingDependencies - Dependências faltantes
 * @property {string[]} requiredSeeds - Seeds RPA que precisam ser executados
 * @property {Object} snapshot - Snapshot do estado do sistema
 */

/**
 * Analisa um fluxo e identifica todas as dependências necessárias.
 * 
 * @param {Object} flow - FlowDefinition
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<DependencyResolutionResult>}
 */
async function resolveDependencies(flow, tenantId) {
  if (!flow || !flow.nodes) {
    throw new Error('Fluxo inválido: deve ter nodes');
  }

  if (!tenantId) {
    // Tenant deve ser fornecido explicitamente - não há mais fallback
    if (!tenantId) {
      throw new Error('Tenant ID é obrigatório para resolver dependências RPA');
    }
  }

  logger.info('[RpaDependencyResolver] Iniciando resolução de dependências', {
    flowId: flow.id,
    flowName: flow.name,
    tenantId,
    nodeCount: flow.nodes.length,
  });

  const dependencies = [];
  const missingDependencies = [];
  const requiredSeeds = [];

  // 1. Analisa cadastros estruturais
  const structuralDeps = await analyzeStructuralDependencies(flow, tenantId);
  dependencies.push(...structuralDeps);

  // 2. Analisa dependências de fluxo
  const flowDeps = await analyzeFlowDependencies(flow, tenantId);
  dependencies.push(...flowDeps);

  // 3. Analisa dependências de RAG
  const ragDeps = await analyzeRagDependencies(flow, tenantId);
  dependencies.push(...ragDeps);

  // 4. Analisa dependências de configuração
  const configDeps = await analyzeConfigDependencies(flow, tenantId);
  dependencies.push(...configDeps);

  // 5. Analisa dependências de teste
  const testDeps = await analyzeTestDependencies(flow, tenantId);
  dependencies.push(...testDeps);

  // Identifica dependências faltantes
  for (const dep of dependencies) {
    if (!dep.exists) {
      missingDependencies.push(dep);
      if (dep.rpaSeedName && !requiredSeeds.includes(dep.rpaSeedName)) {
        requiredSeeds.push(dep.rpaSeedName);
      }
    }
  }

  // Cria snapshot do estado do sistema
  const snapshot = await createSystemSnapshot(tenantId);

  const result = {
    allSatisfied: missingDependencies.length === 0,
    dependencies,
    missingDependencies,
    requiredSeeds,
    snapshot,
  };

  logger.info('[RpaDependencyResolver] Resolução concluída', {
    flowId: flow.id,
    totalDependencies: dependencies.length,
    missingCount: missingDependencies.length,
    requiredSeedsCount: requiredSeeds.length,
    allSatisfied: result.allSatisfied,
  });

  return result;
}

/**
 * Analisa dependências estruturais (departamentos, filas, agentes, etc).
 */
async function analyzeStructuralDependencies(flow, tenantId) {
  const deps = [];

  // Analisa cada nó do fluxo
  for (const node of flow.nodes) {
    // Nós do tipo handoff requerem filas
    if (node.type === 'handoff' && node.config?.queue) {
      const queueName = node.config.queue;
      const queueExists = queueService.listQueues().includes(queueName);
      
      deps.push({
        type: 'queue',
        identifier: queueName,
        exists: queueExists,
        existingData: queueExists ? queueService.getQueueInfo(queueName) : null,
        rpaSeedName: queueExists ? null : 'Seed Plataforma - Criar Fila',
        metadata: {
          nodeId: node.id,
          nodeType: node.type,
          requiredBy: 'handoff',
        },
      });
    }

    // Nós que referenciam departamentos (se houver)
    if (node.config?.department) {
      const deptName = node.config.department;
      const allDepts = departmentsService.listDepartments();
      const dept = allDepts.find(d => d.name.toLowerCase() === deptName.toLowerCase());
      
      deps.push({
        type: 'department',
        identifier: deptName,
        exists: !!dept,
        existingData: dept || null,
        rpaSeedName: dept ? null : 'Seed Plataforma - Criar Departamento',
        metadata: {
          nodeId: node.id,
          nodeType: node.type,
        },
      });
    }

    // Nós que referenciam agentes (se houver)
    if (node.config?.agentId || node.config?.agent) {
      const agentId = node.config.agentId || node.config.agent;
      const agent = authService.getAgent(agentId);
      
      deps.push({
        type: 'agent',
        identifier: agentId,
        exists: !!agent,
        existingData: agent || null,
        rpaSeedName: agent ? null : 'Seed Plataforma - Criar Agente',
        metadata: {
          nodeId: node.id,
          nodeType: node.type,
        },
      });
    }
  }

  return deps;
}

/**
 * Analisa dependências de fluxo (fluxos referenciados, versões, etc).
 */
async function analyzeFlowDependencies(flow, tenantId) {
  const deps = [];

  // Verifica se há referências a outros fluxos
  for (const node of flow.nodes) {
    // Nós que podem referenciar outros fluxos (ex: subflow, call_flow)
    if (node.type === 'call_flow' || node.config?.flowId) {
      const referencedFlowId = node.config?.flowId || node.config?.flow;
      if (referencedFlowId) {
        // Aqui precisaríamos verificar se o fluxo existe
        // Por enquanto, assumimos que fluxos referenciados devem existir
        deps.push({
          type: 'flow',
          identifier: referencedFlowId,
          exists: true, // TODO: verificar se fluxo existe
          existingData: null,
          rpaSeedName: null, // Fluxos não são criados via RPA seed
          metadata: {
            nodeId: node.id,
            nodeType: node.type,
            warning: 'Verificação de fluxo referenciado não implementada',
          },
        });
      }
    }

    // Verifica nós obrigatórios
    if (node.type === 'start' && !flow.nodes.some(n => n.type === 'start')) {
      deps.push({
        type: 'flow_structure',
        identifier: 'start_node',
        exists: false,
        existingData: null,
        rpaSeedName: null, // Estrutura do fluxo não é criada via RPA
        metadata: {
          error: 'Fluxo deve ter nó start',
        },
      });
    }
  }

  return deps;
}

/**
 * Analisa dependências de RAG (bases de conhecimento, documentos, etc).
 */
async function analyzeRagDependencies(flow, tenantId) {
  const deps = [];

  // Verifica se há nós que usam RAG
  for (const node of flow.nodes) {
    if (node.type === 'ai' || node.type === 'ai_task') {
      // Verifica se o nó usa RAG
      const usesRag = node.config?.useRag || node.config?.ragEnabled;
      
      if (usesRag) {
        // Verifica se há base de conhecimento configurada
        const ragBase = node.config?.ragBase || node.config?.knowledgeBase;
        
        if (ragBase) {
          // Verifica se há documentos na base
          const documents = ragDocumentsService.listDocuments({
            tenantId,
            source: 'knowledge_base',
            category: ragBase,
            status: 'active',
          });

          const hasDocuments = documents && documents.length > 0;
          const ragAvailable = await ragService.isRagAvailable();

          deps.push({
            type: 'rag_base',
            identifier: ragBase,
            exists: hasDocuments && ragAvailable,
            existingData: hasDocuments ? {
              documentCount: documents.length,
              ragAvailable,
            } : null,
            rpaSeedName: (hasDocuments && ragAvailable) ? null : 'Seed RAG - Criar Base',
            metadata: {
              nodeId: node.id,
              nodeType: node.type,
              documentCount: documents?.length || 0,
              ragAvailable,
            },
          });

          // Se não há documentos, precisa criar
          if (!hasDocuments) {
            deps.push({
              type: 'rag_document',
              identifier: `${ragBase}_minimal`,
              exists: false,
              existingData: null,
              rpaSeedName: 'Seed RAG - Inserir Documento',
              metadata: {
                nodeId: node.id,
                nodeType: node.type,
                base: ragBase,
                minDocuments: 1,
              },
            });
          }
        }
      }
    }
  }

  return deps;
}

/**
 * Analisa dependências de configuração (integrações, flags, modelos de IA).
 */
async function analyzeConfigDependencies(flow, tenantId) {
  const deps = [];

  // Verifica se há nós que requerem configurações específicas
  for (const node of flow.nodes) {
    // Nós de IA requerem modelo configurado
    if (node.type === 'ai' || node.type === 'ai_task') {
      const model = node.config?.model || config.get('ai.defaultModel', 'gpt-3.5-turbo');
      const modelConfigured = config.get(`ai.models.${model}`, null) !== null;

      deps.push({
        type: 'ai_model',
        identifier: model,
        exists: modelConfigured,
        existingData: modelConfigured ? { model } : null,
        rpaSeedName: null, // Modelos não são configurados via RPA
        metadata: {
          nodeId: node.id,
          nodeType: node.type,
          warning: 'Verificação de modelo de IA não implementada completamente',
        },
      });
    }

    // Verifica integrações necessárias
    if (node.config?.integration) {
      const integrationName = node.config.integration;
      const integrationEnabled = config.get(`integrations.${integrationName}.enabled`, false);

      deps.push({
        type: 'integration',
        identifier: integrationName,
        exists: integrationEnabled,
        existingData: integrationEnabled ? { name: integrationName } : null,
        rpaSeedName: null, // Integrações não são configuradas via RPA
        metadata: {
          nodeId: node.id,
          nodeType: node.type,
        },
      });
    }
  }

  return deps;
}

/**
 * Analisa dependências de teste (usuário de teste, ambiente, permissões).
 */
async function analyzeTestDependencies(flow, tenantId) {
  const deps = [];

  // Verifica se há usuário de teste válido
  const testUser = config.get('test.user', null);
  if (!testUser) {
    deps.push({
      type: 'test_user',
      identifier: 'test_user',
      exists: false,
      existingData: null,
      rpaSeedName: 'Seed Plataforma - Criar Usuário de Teste',
      metadata: {
        requiredFor: 'rpa_execution',
      },
    });
  }

  // Verifica se há agente de teste com permissões suficientes
  const agentsResult = authService.listAgents(tenantId);
  const testAgent = agentsResult?.agents?.find(a => a.role === 'admin' || a.role === 'supervisor');
  if (!testAgent) {
    deps.push({
      type: 'test_agent',
      identifier: 'test_agent',
      exists: false,
      existingData: null,
      rpaSeedName: 'Seed Plataforma - Criar Agente',
      metadata: {
        requiredFor: 'rpa_execution',
        minRole: 'supervisor',
      },
    });
  }

  return deps;
}

/**
 * Cria um snapshot do estado atual do sistema.
 */
async function createSystemSnapshot(tenantId) {
  const departments = departmentsService.listDepartments();
  const queues = queueService.listQueues();
  const agents = authService.listAgents(tenantId);
  const documents = ragDocumentsService.listDocuments({ tenantId });
  const ragAvailable = await ragService.isRagAvailable();

  return {
    timestamp: new Date().toISOString(),
    tenantId,
    departments: {
      count: departments?.length || 0,
      names: departments?.map(d => d.name) || [],
    },
    queues: {
      count: queues.length,
      names: queues,
    },
    agents: {
      count: agents?.agents?.length || 0,
      roles: agents?.agents?.map(a => a.role) || [],
    },
    rag: {
      available: ragAvailable,
      documentCount: documents?.length || 0,
    },
  };
}

/**
 * Mapeia dependências faltantes para seeds RPA que devem ser executados.
 * 
 * @param {Dependency[]} missingDependencies - Lista de dependências faltantes
 * @returns {Array<{seedName: string, dependencies: Dependency[]}>}
 */
function mapDependenciesToSeeds(missingDependencies) {
  const seedMap = new Map();

  for (const dep of missingDependencies) {
    if (dep.rpaSeedName) {
      if (!seedMap.has(dep.rpaSeedName)) {
        seedMap.set(dep.rpaSeedName, []);
      }
      seedMap.get(dep.rpaSeedName).push(dep);
    }
  }

  return Array.from(seedMap.entries()).map(([seedName, deps]) => ({
    seedName,
    dependencies: deps,
  }));
}

module.exports = {
  resolveDependencies,
  mapDependenciesToSeeds,
};

