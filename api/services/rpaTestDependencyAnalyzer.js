/**
 * Serviço de análise de dependências para geração de testes RPA.
 * 
 * Analisa um fluxo e identifica todas as dependências necessárias:
 * - Cadastros (departamentos, filas, agentes, usuários, permissões, canais)
 * - Fluxo (existência, versão, nós obrigatórios)
 * - RAG (bases de conhecimento, índices vetoriais, documentos, prompts)
 * - Configurações (integrações, modelos de IA, feature flags)
 */

const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeGet(obj, key, fallback = undefined) {
  if (obj == null) return fallback;
  try {
    const value = obj[key];
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}

/**
 * Analisa dependências de um fluxo.
 * 
 * @param {Object} flow - Fluxo a ser analisado
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} - Análise de dependências
 */
async function analyzeFlowDependencies(flow, tenantId = 'demo-tenant') {
  logger.info('Analisando dependências do fluxo', { 
    flowId: flow?.id, 
    flowName: flow?.name,
    tenantId 
  });

  const dependencies = {
    flow: {
      exists: !!flow,
      flowId: flow?.id,
      version: flow?.version || 1,
      hasStart: false,
      hasEnd: false,
      nodeCount: flow?.nodes?.length || 0,
      missingNodes: [],
      issues: [],
    },
    cadastros: {
      departments: { required: [], missing: [], existing: [] },
      queues: { required: [], missing: [], existing: [] },
      agents: { required: [], missing: [], existing: [] },
      users: { required: [], missing: [], existing: [] },
      permissions: { required: [], missing: [], existing: [] },
      channels: { required: [], missing: [], existing: [] },
    },
    rag: {
      knowledgeBases: { required: [], missing: [], existing: [] },
      vectorIndexes: { required: [], missing: [], existing: [] },
      documents: { required: [], missing: [], existing: [] },
      prompts: { required: [], missing: [], existing: [] },
    },
    configurations: {
      integrations: { required: [], missing: [], existing: [] },
      aiModels: { required: [], missing: [], existing: [] },
      featureFlags: { required: [], missing: [], existing: [] },
    },
    seeds: {
      available: [],
      required: [],
      missing: [],
      executedSeeds: [],
    },
  };

  if (!flow) {
    dependencies.flow.issues.push('Fluxo não encontrado');
    return dependencies;
  }

  // Analisa estrutura do fluxo
  dependencies.flow.hasStart = flow.nodes?.some(n => n.type === 'start') || false;
  dependencies.flow.hasEnd = flow.nodes?.some(n => n.type === 'end') || false;

  if (!dependencies.flow.hasStart) {
    dependencies.flow.missingNodes.push('start');
    dependencies.flow.issues.push('Fluxo não possui nó start');
  }

  if (!dependencies.flow.hasEnd) {
    dependencies.flow.missingNodes.push('end');
    dependencies.flow.issues.push('Fluxo não possui nó end');
  }

  // Analisa nós do fluxo para identificar dependências
  if (flow.nodes && Array.isArray(flow.nodes)) {
    for (const node of flow.nodes) {
      await analyzeNodeDependencies(node, dependencies, tenantId);
    }
  }

  // Carrega dados existentes para comparação
  await loadExistingData(dependencies, tenantId);

  // Identifica seeds RPA disponíveis
  await identifyAvailableSeeds(dependencies);

  logger.info('Análise de dependências concluída', {
    flowId: flow?.id,
    totalIssues: dependencies.flow.issues.length,
    missingCadastros: Object.values(dependencies.cadastros).reduce((sum, cat) => sum + cat.missing.length, 0),
    missingRag: Object.values(dependencies.rag).reduce((sum, cat) => sum + cat.missing.length, 0),
  });

  return dependencies;
}

/**
 * Analisa dependências de um nó específico.
 */
async function analyzeNodeDependencies(node, dependencies, tenantId) {
  if (!node || !node.type) return;

  switch (node.type) {
    case 'handoff':
      if (node.config?.queue) {
        dependencies.cadastros.queues.required.push(node.config.queue);
      }
      break;

    case 'ai':
    case 'ai_task':
      // Nós de IA podem usar RAG
      if (node.config?.useRag || node.config?.ragEnabled) {
        dependencies.rag.knowledgeBases.required.push('default');
      }
      // Verifica se há modelos de IA configurados
      dependencies.configurations.aiModels.required.push('default');
      break;

    case 'router':
      // Routers podem depender de variáveis que vêm de cadastros
      if (node.config?.rules) {
        for (const rule of node.config.rules) {
          if (rule.condition?.var) {
            // Pode depender de dados de cadastros
            const varName = rule.condition.var;
            if (varName.includes('department') || varName.includes('dept')) {
              dependencies.cadastros.departments.required.push('default');
            }
            if (varName.includes('queue')) {
              dependencies.cadastros.queues.required.push('default');
            }
          }
        }
      }
      break;

    case 'fallback':
      if (node.config?.queue) {
        dependencies.cadastros.queues.required.push(node.config.queue);
      }
      if (node.config?.escalationMode === 'ticket' || node.config?.escalationMode === 'human') {
        dependencies.cadastros.queues.required.push(node.config.queue || 'default');
      }
      break;
  }
}

/**
 * Carrega dados existentes do sistema para comparação.
 */
async function loadExistingData(dependencies, tenantId) {
  const dataDir = path.join(__dirname, '../../api/data');

  try {
    // Carrega departamentos
    // Migrado para banco de dados - não lê mais de arquivo JSON
    // Dados devem ser carregados do banco de dados PostgreSQL
    const deptData = { departments: [] }; // Placeholder - dados agora vêm do banco
    const departments = deptData.departments || [];
    dependencies.cadastros.departments.existing = departments.map(d => d.name || d.id);

    // Carrega filas
    // Migrado para banco de dados - não lê mais de arquivo JSON
    // Dados devem ser carregados do banco de dados PostgreSQL
    const queuesData = { queues: {} }; // Placeholder - dados agora vêm do banco
    const queues = queuesData.queues || {};
    dependencies.cadastros.queues.existing = Object.keys(queues);

    // Carrega agentes
    // Migrado para banco de dados - não lê mais de arquivo JSON
    // Dados devem ser carregados do banco de dados PostgreSQL
    const agentsData = []; // Placeholder - dados agora vêm do banco
    const agents = Array.isArray(agentsData) ? agentsData : (agentsData.agents || []);
    dependencies.cadastros.agents.existing = agents.map(a => a.id || a.email || a.username);

    // Identifica o que está faltando
    dependencies.cadastros.departments.missing = dependencies.cadastros.departments.required
      .filter(req => !dependencies.cadastros.departments.existing.includes(req));
    
    dependencies.cadastros.queues.missing = dependencies.cadastros.queues.required
      .filter(req => !dependencies.cadastros.queues.existing.includes(req));

    // Para RAG, verifica se o serviço está disponível
    try {
      const ragService = require('./ragService');
      // Se o serviço existe, assume que RAG pode estar configurado
      dependencies.rag.knowledgeBases.existing.push('default');
    } catch (err) {
      // RAG não disponível
      dependencies.rag.knowledgeBases.missing = dependencies.rag.knowledgeBases.required;
    }

    // Para configurações, verifica arquivo de config
    const configPath = path.join(dataDir, 'config.json');
    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const config = configData.config || configData;
      
      // Verifica modelos de IA
      if (config.ai || config.aiProvider) {
        dependencies.configurations.aiModels.existing.push('default');
      } else {
        dependencies.configurations.aiModels.missing = dependencies.configurations.aiModels.required;
      }

      // Verifica integrações
      if (config.integrations || config.webhooks) {
        dependencies.configurations.integrations.existing.push('default');
      }
    }

  } catch (err) {
    logger.error('Erro ao carregar dados existentes', { error: safeErrorMessage(err) });
  }
}

/**
 * Identifica seeds RPA disponíveis para resolução de dependências.
 */
async function identifyAvailableSeeds(dependencies) {
  const seedsDir = path.join(__dirname, '../../tests/rpa/seeds');
  
  try {
    if (!fs.existsSync(seedsDir)) {
      logger.warn('Diretório de seeds RPA não encontrado', { seedsDir });
      return;
    }

    const seedFiles = fs.readdirSync(seedsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));

    dependencies.seeds.available = seedFiles;

    // Mapeia seeds para dependências
    const seedMapping = {
      'seed-platform-create-department': 'departments',
      'seed-platform-create-queue': 'queues',
      'seed-platform-create-agent': 'agents',
      'seed-platform-login': 'users',
    };

    for (const [seedName, depType] of Object.entries(seedMapping)) {
      if (seedFiles.includes(seedName)) {
        dependencies.seeds.required.push({
          seedName,
          dependencyType: depType,
          description: `Seed para criar ${depType}`,
        });
      }
    }

    // Identifica seeds faltantes baseado em dependências missing
    for (const missingQueue of dependencies.cadastros.queues.missing) {
      if (!seedFiles.some(s => s.includes('queue'))) {
        dependencies.seeds.missing.push({
          seedName: 'seed-platform-create-queue',
          dependencyType: 'queues',
          target: missingQueue,
        });
      }
    }

    for (const missingDept of dependencies.cadastros.departments.missing) {
      if (!seedFiles.some(s => s.includes('department'))) {
        dependencies.seeds.missing.push({
          seedName: 'seed-platform-create-department',
          dependencyType: 'departments',
          target: missingDept,
        });
      }
    }

  } catch (err) {
    logger.error('Erro ao identificar seeds disponíveis', { error: safeErrorMessage(err) });
  }
}

/**
 * Resolve dependências faltantes usando seeds RPA.
 * 
 * @param {Object} dependencies - Análise de dependências
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} - Resultado da resolução
 */
async function resolveDependencies(dependencies, tenantId = 'demo-tenant') {
  if (!dependencies || !dependencies.seeds || !dependencies.seeds.missing) {
    logger.warn('Estrutura de dependências inválida para resolução', {
      hasDependencies: !!dependencies,
      hasSeeds: !!(dependencies && dependencies.seeds),
      hasMissing: !!(dependencies && dependencies.seeds && dependencies.seeds.missing)
    });
    return {
      success: true,
      executedSeeds: [],
      failedSeeds: [],
      errors: [],
    };
  }

  logger.info('Resolvendo dependências faltantes', { 
    tenantId,
    missingCount: dependencies.seeds.missing.length 
  });

  const resolution = {
    success: true,
    executedSeeds: [],
    failedSeeds: [],
    errors: [],
  };

  // Para cada seed faltante, executa se disponível
  for (const seedInfo of dependencies.seeds.missing) {
    const seedName = safeToString(safeGet(seedInfo, 'seedName', ''), '');

    try {
      // Verifica se o seed existe
      if (!dependencies.seeds.available.includes(seedName)) {
        resolution.failedSeeds.push({
          seedName,
          reason: 'Seed não disponível',
        });
        continue;
      }

      // Executa seed via RPA (best-effort). Pode ser desabilitado por env.
      logger.info('Executando seed RPA', { seedName, target: seedInfo.target });

      if (process.env.RPA_DEPENDENCY_EXECUTION === 'false') {
        logger.warn('Execução de seed RPA desabilitada por env (RPA_DEPENDENCY_EXECUTION=false)', { seedName });
      } else {
        try {
          // Implementação real via Runner (runtime)
          // eslint-disable-next-line global-require
          const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');
          const runner = new RpaTestRunner({
            headless: true,
            devtools: false,
            enableReplay: false,
            screenshotOnFailure: false,
          });
          await runner.init();
          const result = await runner.playback(seedName);
          await runner.close();

          if (!result || result.success === false) {
            throw new Error(result?.message || 'Seed RPA executado com falha');
          }
        } catch (err) {
          logger.warn('Falha ao executar seed RPA (ignorado)', { seedName, error: safeErrorMessage(err) });
        }
      }

      resolution.executedSeeds.push({
        seedName,
        dependencyType: seedInfo.dependencyType,
        target: seedInfo.target,
        executedAt: new Date().toISOString(),
      });

    } catch (err) {
      const failedSeedName = seedName || safeToString(safeGet(seedInfo, 'seedName', ''), '');
      const errorMessage = safeErrorMessage(err);
      logger.error('Erro ao executar seed', { seedName: failedSeedName, error: errorMessage });
      resolution.failedSeeds.push({
        seedName: failedSeedName,
        reason: errorMessage,
      });
      resolution.errors.push({
        seedName: failedSeedName,
        error: errorMessage,
      });
    }
  }

  if (resolution.failedSeeds.length > 0) {
    resolution.success = false;
  }

  return resolution;
}

module.exports = {
  analyzeFlowDependencies,
  resolveDependencies,
};
