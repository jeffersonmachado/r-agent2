import logger from '../../utils/logger';
import { getNodeSchema } from '../nodeSchemas';

type ValidationErrorLike =
  | string
  | {
      code?: string;
      message?: string;
      messageUi?: string;
      severity?: string;
      source?: 'local' | 'backend';
      [key: string]: any;
    };

function isBackendValidationError(err: ValidationErrorLike) {
  return typeof err === 'object' && !!err && err.source === 'backend';
}

function isLocalValidationError(err: ValidationErrorLike) {
  return typeof err === 'object' && !!err && err.source === 'local';
}

/**
 * Aplica erros de validação do backend aos nós do editor
 * @param {any} editor - Instância do editor Rete.js
 * @param {any} area - Instância do AreaPlugin
 * @param {Array<{ nodeIds?: string[], message: string }>} backendErrors - Erros do backend com nodeIds (IDs do engine)
 */
export function applyBackendValidationErrors(editor, area, backendErrors) {
  if (!editor || !backendErrors || !Array.isArray(backendErrors)) return;
  
  // Cria mapa de engineId -> nodeId do editor
  // Os nodeIds do backend são os IDs numéricos do JSON Rete (ex: "1", "2", "3")
  // Precisamos mapear para os IDs reais dos nós no editor
  // ✅ CORREÇÃO: Garante que usamos a mesma ordem que o toJSON() usa
  // O toJSON() itera sobre editor.getNodes() usando forEach com índice
  // Precisamos garantir que usamos Array.from() para manter ordem consistente
  const engineIdToEditorNode = new Map();
  
  // Obtém nós do editor e converte para array para garantir ordem consistente
  // Isso garante que a ordem seja a mesma que o toJSON() usa
  const nodes = Array.from(editor.getNodes());
  
  // Cria mapeamento: para cada nó, calcula qual seria seu ID no JSON Rete
  // Segue a mesma lógica de toJSON() em createEditor.js (linha 112-115)
  nodes.forEach((node, index) => {
    const jsonId = String(index + 1); // ID no JSON Rete (1, 2, 3...)
    engineIdToEditorNode.set(jsonId, node);
  });
  
  logger.debug('applyBackendValidationErrors - mapeamento criado', {
    totalNodes: nodes.length,
    mappedIds: Array.from(engineIdToEditorNode.keys()),
    nodeIds: nodes.map(n => n.id),
  });
  
  // ✅ Se backendErrors está vazio, limpa todos os erros do backend dos nós
  // Se tem erros, limpa erros do backend existentes antes de aplicar novos
  if (backendErrors.length === 0) {
    // ✅ Remove apenas erros marcados como source="backend" (mantém erros locais)
    nodes.forEach((node) => {
      if (node.data?.validation?.errors) {
        const remainingErrors = (node.data.validation.errors as ValidationErrorLike[]).filter(
          (err) => !isBackendValidationError(err),
        );

        node.data.validation.errors = remainingErrors;
        node.data.validation.status = remainingErrors.length > 0 ? 'invalid' : 'valid';
        
        if (area && typeof area.update === 'function') {
          try {
            area.update('node', node.id);
          } catch (err) {
            logger.warn('Erro ao atualizar nó via area.update', { nodeId: node.id, error: err });
          }
        }
      }
    });
    return; // Não há erros para aplicar
  }
  
  // ✅ Limpa erros do backend existentes (mantém apenas erros locais)
  nodes.forEach((node) => {
    if (node.data?.validation?.errors) {
      node.data.validation.errors = (node.data.validation.errors as ValidationErrorLike[]).filter(
        (err) => !isBackendValidationError(err),
      );
    }
  });
  
  // ✅ Aplica novos erros do backend
  const nodesWithErrors = new Set();
  const globalErrors = []; // Erros globais (sem nodeIds ou com nodeIds vazio)
  
  backendErrors.forEach((error) => {
    // Verifica se é erro global (sem nodeIds ou com array vazio)
    if (!error.nodeIds || !Array.isArray(error.nodeIds) || error.nodeIds.length === 0) {
      globalErrors.push(error);
      logger.debug('applyBackendValidationErrors - erro global detectado', {
        code: error.code,
        message: error.message || error.messageUi,
      });
      return; // Erros globais não são aplicados a nós específicos, apenas exibidos no painel
    }
    
    error.nodeIds.forEach((engineId) => {
      const editorNode = engineIdToEditorNode.get(String(engineId));
      if (editorNode) {
        if (!editorNode.data) {
          editorNode.data = {};
        }
        if (!editorNode.data.validation) {
          editorNode.data.validation = { status: 'valid', errors: [] };
        }
        
        // Adiciona erro do backend como objeto com code, message (técnica) e messageUi (amigável)
        const errorCode = error.code || 'VALIDATION_ERROR';
        const errorMessage = error.message || 'Erro de validação';
        const errorMessageUi = error.messageUi || errorMessage; // Usa messageUi se disponível, senão usa message
        
        // Verifica se o erro já existe (evita duplicatas)
        const errorExists = (editorNode.data.validation.errors as ValidationErrorLike[]).some((err) => {
          if (typeof err === 'string') return err === errorMessage;
          if (typeof err !== 'object' || !err) return false;
          return err.source === 'backend' && err.code === errorCode && err.message === errorMessage;
        });
        
        if (!errorExists) {
          editorNode.data.validation.errors.push({
            source: 'backend',
            code: errorCode,
            message: errorMessage, // ✅ Mensagem técnica original
            messageUi: errorMessageUi, // ✅ Mensagem amigável
            severity: error.severity || 'error',
            details: error.details || {},
          });
        }
        
        editorNode.data.validation.status = 'invalid';
        nodesWithErrors.add(editorNode.id);
        
        logger.debug('applyBackendValidationErrors - erro aplicado ao nó', {
          engineId,
          editorNodeId: editorNode.id,
          nodeType: editorNode.data?.type,
          errorMessage,
        });
      } else {
        logger.warn('applyBackendValidationErrors - nó não encontrado para engineId', {
          engineId,
          availableIds: Array.from(engineIdToEditorNode.keys()),
        });
      }
    });
  });
  
  // Atualiza visualização dos nós afetados
  nodesWithErrors.forEach((nodeId) => {
    if (area && typeof area.update === 'function') {
      try {
        area.update('node', nodeId);
      } catch (err) {
        logger.warn('Erro ao atualizar nó via area.update', { nodeId, error: err });
      }
    }
  });
  
  logger.debug('applyBackendValidationErrors - erros aplicados', {
    errorCount: backendErrors.length,
    globalErrorsCount: globalErrors.length,
    nodeSpecificErrorsCount: backendErrors.length - globalErrors.length,
    nodesAffected: nodesWithErrors.size,
    nodeIds: Array.from(nodesWithErrors),
    globalErrorCodes: globalErrors.map(e => e.code),
  });
}

export function runFlowValidation(editor, area?: any) {
    if (!editor) return;
  
    const nodes = editor.getNodes();
    const connections =
      typeof editor.getConnections === 'function' ? editor.getConnections() : [];
    
    logger.debug('runFlowValidation - iniciando validação', {
      nodeCount: nodes.length,
    });
  
    for (const node of nodes) {
      const nodeType = node?.data?.type || node?.type || 'unknown';

      const schema = getNodeSchema(nodeType);

      // Extrai targets conectados a partir das conexões do editor
      const nextTargets = Array.from(
        new Set(
          (connections || [])
            .filter((c: any) => c && String(c.source) === String(node.id))
            .map((c: any) => String(c.target)),
        ),
      );

      // Adapta nó do Rete para o formato esperado pelos schemas (engine-like)
      const plainNode = {
        id: String(node.id),
        type: nodeType,
        config: (node?.data?.config && typeof node.data.config === 'object') ? node.data.config : {},
        next: nextTargets.length > 0 ? nextTargets : null,
      };

      let localErrors: ValidationErrorLike[] = [];

      if (!schema || typeof schema.validate !== 'function') {
        localErrors = [
          {
            source: 'local',
            code: 'UNKNOWN_NODE_TYPE',
            message: `Tipo de nó desconhecido: "${nodeType}".`,
            messageUi: `Tipo de nó desconhecido: "${nodeType}".`,
            severity: 'error',
            nodeIds: [String(node.id)],
          },
        ];
      } else {
        const schemaErrors = schema.validate(plainNode) || [];
        localErrors = (Array.isArray(schemaErrors) ? schemaErrors : [schemaErrors]).map((err) => {
          if (typeof err === 'string') return err;
          if (typeof err === 'object' && err) {
            return { source: 'local', ...err };
          }
          return {
            source: 'local',
            code: 'VALIDATION_ERROR',
            message: 'Erro de validação',
            messageUi: 'Erro de validação',
            severity: 'error',
            nodeIds: [String(node.id)],
          };
        });
      }

      const existingErrors: ValidationErrorLike[] = (node?.data?.validation?.errors || []) as any;
      const backendErrors = existingErrors.filter((err) => isBackendValidationError(err));

      // Mantém só 1 set “local” vigente (substitui locais antigos pelos novos)
      const mergedErrors = [...backendErrors, ...localErrors];
  
      // ✅ Usa erros exatamente como estão (sem transformação)
      // Erros locais são strings, erros do backend são objetos com code e message
      if (!node.data) node.data = {};
      node.data.validation = {
        status: mergedErrors.length ? 'invalid' : 'valid',
        errors: mergedErrors,
      };
      
      // ✅ Usa area.update() para forçar re-render do React (padrão do Rete.js v2)
      // Isso garante que a classe CSS 'flow-node--error' seja aplicada
      // Referência: https://github.com/retejs/reference/blob/main/src/rete/default.ts#L191
      if (area && typeof area.update === 'function') {
        try {
          area.update('node', node.id);
        } catch (err) {
          logger.warn('Erro ao atualizar nó via area.update', { nodeId: node.id, error: err });
        }
      }
      
      if (mergedErrors.length > 0) {
        logger.debug('runFlowValidation - nó marcado como inválido', {
          nodeId: node.id,
          nodeType,
          errorCount: mergedErrors.length,
          errors: mergedErrors,
        });
      }
    }
    
    logger.debug('runFlowValidation - validação concluída', {
      nodeCount: nodes.length,
      invalidCount: nodes.filter(n => n.data?.validation?.status === 'invalid').length,
    });
  }