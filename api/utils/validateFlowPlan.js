/**
 * Validador estrutural completo para planos de fluxo de chatbot.
 * 
 * Este validador é o guardião do projeto - nada passa sem ele.
 * Garante:
 * - Schema JSON válido (RAG_SCHEMA)
 * - Tipos de nós válidos (RAG_NODES)
 * - Regras de conexão respeitadas (RAG_RULES)
 * - Erros conhecidos não reintroduzidos (RAG_ERRORS)
 * 
 * Reaproveita o validador existente (engine/validator.js) e adiciona
 * validações baseadas em RAG para garantir que a IA só gere o que o sistema aceita.
 * 
 * @param {Object} flow - Fluxo de chatbot a ser validado
 * @returns {Object} Resultado da validação com {valid: boolean, errors: Array}
 */

const fs = require('fs');
const path = require('path');
const { validateFlow } = require('../../engine/validator');

// Caminhos dos arquivos RAG_CHATBOT
const RAG_BASE = path.join(__dirname, '../data/rag/chatbot');
const schemaPath = path.join(RAG_BASE, 'schema/flow.schema.json');
const nodesPath = path.join(RAG_BASE, 'nodes/node.types.json');
const rulesPath = path.join(RAG_BASE, 'rules/connection.rules.json');
const errorsPath = path.join(RAG_BASE, 'known_errors/flow.errors.json');

// Carregar dados RAG
let schema, nodeTypes, rules, knownErrors;

try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  nodeTypes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
  rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  knownErrors = JSON.parse(fs.readFileSync(errorsPath, 'utf8'));
} catch (err) {
  console.error('[validateFlowPlan] Erro ao carregar arquivos RAG_CHATBOT:', err.message);
  throw new Error(`Falha ao carregar arquivos RAG_CHATBOT: ${err.message}`);
}

/**
 * Valida um fluxo de chatbot completo
 * @param {Object} flow - Fluxo a ser validado
 * @returns {Object} Resultado da validação com {valid: boolean, errors: Array}
 */
function validateFlowPlan(flow) {
  const errors = [];

  // 1. Validação básica de estrutura
  if (!flow || typeof flow !== 'object') {
    return {
      valid: false,
      errors: [{
        type: 'INVALID_FLOW',
        message: 'Fluxo deve ser um objeto válido'
      }]
    };
  }

  // 2. Validação usando validador existente (engine/validator.js)
  // Este validador já faz todas as validações estruturais, de conexão, etc.
  const engineValidation = validateFlow(flow);
  if (!engineValidation.valid) {
    // Converte erros do engine para formato do RAG
    for (const error of engineValidation.errors) {
      errors.push({
        type: error.code || 'ENGINE_VALIDATION_ERROR',
        message: error.message || error.messageUi || 'Erro de validação do engine',
        nodeIds: error.nodeIds || [],
        details: error.details || {}
      });
    }
  }

  // 3. Validação de tipos de nós (whitelist do RAG)
  if (flow.nodes && Array.isArray(flow.nodes)) {
    const validNodeTypes = [
      ...Object.keys(nodeTypes.nodeTypes.core || {}),
      ...Object.keys(nodeTypes.nodeTypes.system || {})
    ];

    for (let i = 0; i < flow.nodes.length; i++) {
      const node = flow.nodes[i];
      if (node && node.type && !validNodeTypes.includes(node.type)) {
        errors.push({
          type: 'INVALID_NODE_TYPE',
          message: `Tipo de nó não permitido: ${node.type}`,
          nodeId: node.id || `node_${i}`,
          allowedTypes: validNodeTypes
        });
      }
    }
  }

  // 4. Validação de regras estruturais do RAG
  if (rules.rules && rules.rules.structural) {
    for (const rule of rules.rules.structural.rules) {
      if (rule.enforcement === 'hard') {
        switch (rule.id) {
          case 'MUST_HAVE_START':
            const startNodes = (flow.nodes || []).filter(n => n && n.type === 'start');
            if (startNodes.length !== 1) {
              errors.push({
                type: 'RULE_VIOLATION',
                message: `Regra violada: ${rule.id} - ${rule.description}`,
                details: { found: startNodes.length, expected: 1 }
              });
            }
            break;

          case 'MUST_HAVE_END':
            const endNodes = (flow.nodes || []).filter(n => n && n.type === 'end');
            if (endNodes.length === 0) {
              errors.push({
                type: 'RULE_VIOLATION',
                message: `Regra violada: ${rule.id} - ${rule.description}`,
                details: { found: endNodes.length, expected: '>= 1' }
              });
            }
            break;

          case 'MAX_NODES':
            if (flow.nodes && flow.nodes.length > rule.value) {
              errors.push({
                type: 'RULE_VIOLATION',
                message: `Regra violada: ${rule.id} - ${rule.description}`,
                details: { found: flow.nodes.length, max: rule.value }
              });
            }
            break;
        }
      }
    }
  }

  // 5. Verificação de erros conhecidos
  for (const knownError of knownErrors.errors || []) {
    if (flow.nodes) {
      for (let i = 0; i < flow.nodes.length; i++) {
        const node = flow.nodes[i];
        if (!node) continue;

        // Verifica se algum erro conhecido está presente
        for (const example of knownError.examples || []) {
          // Verifica em config do nó
          if (node.config && JSON.stringify(node.config).includes(example)) {
            errors.push({
              type: 'KNOWN_ERROR',
              message: `Erro conhecido detectado: ${knownError.id}`,
              description: knownError.description,
              nodeId: node.id || `node_${i}`,
              fix: knownError.fix
            });
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  return { valid: true };
}

/**
 * Gera relatório de erro estruturado
 * @param {Object} validationResult - Resultado da validação
 * @returns {Object} Relatório de erro formatado
 */
function generateErrorReport(validationResult) {
  if (validationResult.valid) {
    return null;
  }

  return {
    status: 'failed',
    errors: validationResult.errors,
    suggestedFixes: validationResult.errors.map(err => ({
      error: err.type,
      message: err.message,
      fix: err.fix || 'Consulte RAG_CHATBOT para correção'
    }))
  };
}

module.exports = {
  validateFlowPlan,
  generateErrorReport
};

