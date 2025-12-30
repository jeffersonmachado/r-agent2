/**
 * Validador estático para nós do tipo ai_task.
 *
 * Responsabilidades:
 * - Validar estrutura do nó ai_task
 * - Validar configuração (task, allowedOutputs, fallback, confidenceThreshold)
 * - Garantir que o fluxo não depende exclusivamente de IA
 *
 * Princípios:
 * - Validação puramente estática (sem execução)
 * - Mensagens de erro claras e acionáveis
 */

import { SUPPORTED_TASKS } from '@shared/aiTaskExecutor';

/**
 * Valida um nó do tipo ai_task.
 *
 * @param {Object} node - Nó a ser validado
 * @param {Object} flow - Fluxo completo (para validações contextuais)
 * @returns {Array<{code: string, message: string, messageUi: string, nodeId: string}>} Lista de erros
 */
export function validateAiTaskNode(node, flow) {
  const errors = [];

  if (!node || typeof node !== 'object') {
    return [
      {
        code: 'INVALID_NODE_STRUCTURE',
        message: 'Nó ai_task deve ser um objeto válido',
        messageUi: 'Nó de tarefa de IA inválido',
        nodeId: node?.id || 'unknown',
      },
    ];
  }

  const nodeId = node.id || 'unknown';

  // Validação: config deve existir
  if (!node.config || typeof node.config !== 'object') {
    errors.push({
      code: 'AI_TASK_MISSING_CONFIG',
      message: 'Nó ai_task deve ter campo "config"',
      messageUi: 'Nó de tarefa de IA precisa de configuração',
      nodeId,
    });
    return errors; // Não podemos continuar sem config
  }

  const config = node.config;

  // Validação: task deve estar definida
  if (!config.task || typeof config.task !== 'string') {
    errors.push({
      code: 'AI_TASK_MISSING_TASK',
      message: 'Campo "config.task" é obrigatório e deve ser uma string',
      messageUi: 'Nó de tarefa de IA precisa definir o tipo de tarefa',
      nodeId,
    });
  } else {
    // Validação: task deve ser uma das tarefas suportadas
    // Verifica se SUPPORTED_TASKS está definido
    if (!SUPPORTED_TASKS || typeof SUPPORTED_TASKS !== 'object') {
      errors.push({
        code: 'AI_TASK_VALIDATION_ERROR',
        message: 'Erro ao validar tarefa: SUPPORTED_TASKS não está disponível',
        messageUi: 'Erro ao validar tipo de tarefa de IA',
        nodeId,
      });
    } else {
      const supportedTasks = Object.values(SUPPORTED_TASKS);
      if (!supportedTasks.includes(config.task)) {
        errors.push({
          code: 'AI_TASK_UNSUPPORTED_TASK',
          message: `Tarefa "${config.task}" não é suportada. Tarefas suportadas: ${supportedTasks.join(', ')}`,
          messageUi: `Tipo de tarefa de IA não suportado: ${config.task}`,
          nodeId,
        });
      }
    }
  }

  // Validação específica por tipo de tarefa
  if (config.task === 'intent_classification') {
    // allowedOutputs deve ser um array não vazio
    if (!Array.isArray(config.allowedOutputs) || config.allowedOutputs.length === 0) {
      errors.push({
        code: 'AI_TASK_MISSING_ALLOWED_OUTPUTS',
        message: 'Para intent_classification, "config.allowedOutputs" deve ser um array não vazio',
        messageUi: 'Nó de classificação de intenção precisa definir as intenções permitidas',
        nodeId,
      });
    }

    // fallback deve estar definido
    if (config.fallback === undefined || config.fallback === null || config.fallback === '') {
      errors.push({
        code: 'AI_TASK_MISSING_FALLBACK',
        message: 'Para intent_classification, "config.fallback" é obrigatório',
        messageUi: 'Nó de classificação de intenção precisa definir um valor de fallback',
        nodeId,
      });
    }

    // confidenceThreshold deve ser um número válido entre 0 e 1
    if (config.confidenceThreshold !== undefined) {
      if (typeof config.confidenceThreshold !== 'number') {
        errors.push({
          code: 'AI_TASK_INVALID_CONFIDENCE_THRESHOLD',
          message: 'Campo "config.confidenceThreshold" deve ser um número',
          messageUi: 'Limite de confiança deve ser um número',
          nodeId,
        });
      } else if (config.confidenceThreshold < 0 || config.confidenceThreshold > 1) {
        errors.push({
          code: 'AI_TASK_INVALID_CONFIDENCE_RANGE',
          message: 'Campo "config.confidenceThreshold" deve estar entre 0 e 1',
          messageUi: 'Limite de confiança deve estar entre 0 e 1',
          nodeId,
        });
      }
    }
  }

  // Validação: o fluxo não pode depender exclusivamente de IA
  // (deve haver pelo menos um caminho alternativo)
  // Nota: Esta validação é mais complexa e pode ser feita em nível de fluxo,
  // mas aqui verificamos se o nó tem um "next" definido (caminho de fallback)
  if (!node.next) {
    errors.push({
      code: 'AI_TASK_NO_FALLBACK_PATH',
      message: 'Nó ai_task deve ter um caminho de fallback definido (campo "next")',
      messageUi: 'Nó de tarefa de IA precisa ter um próximo nó definido',
      nodeId,
    });
  }

  return errors;
}

/**
 * Valida se o fluxo não depende exclusivamente de IA.
 * 
 * Esta validação verifica se há caminhos alternativos no fluxo
 * que não dependem de nós ai_task.
 *
 * @param {Object} flow - Fluxo completo
 * @returns {Array<{code: string, message: string, messageUi: string}>} Lista de erros
 */
export function validateFlowDoesNotDependExclusivelyOnAI(flow) {
  const errors = [];

  if (!flow || !Array.isArray(flow.nodes)) {
    return errors;
  }

  const aiTaskNodes = flow.nodes.filter((n) => n.type === 'ai_task');
  
  // Se não há nós de IA, não há problema
  if (aiTaskNodes.length === 0) {
    return errors;
  }

  // Verifica se todos os caminhos do fluxo passam por nós de IA
  // Esta é uma validação simplificada; uma validação completa exigiria
  // análise de grafo (verificar se há caminhos que não passam por ai_task)
  // Por enquanto, apenas avisamos se há muitos nós de IA
  if (aiTaskNodes.length > flow.nodes.length * 0.5) {
    errors.push({
      code: 'FLOW_TOO_MANY_AI_TASKS',
      message: 'Fluxo tem muitos nós de IA (>50% dos nós). Considere adicionar caminhos alternativos.',
      messageUi: 'Fluxo tem muitos nós de tarefa de IA. Adicione caminhos alternativos.',
    });
  }

  return errors;
}

