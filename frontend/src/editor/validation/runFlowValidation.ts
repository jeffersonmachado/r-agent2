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

type ValidationSeverity = 'error' | 'warning' | 'info';
type ValidationStatus = 'valid' | 'warning' | 'info' | 'invalid';

function normalizeSeverity(err: ValidationErrorLike): ValidationSeverity {
  // Strings são sempre erros (não temos como inferir warning)
  if (typeof err === 'string') return 'error';
  if (!err || typeof err !== 'object') return 'error';
  const sev = String(err.severity || '').toLowerCase();
  if (sev === 'warning') return 'warning';
  if (sev === 'info') return 'info';
  return 'error';
}

function computeStatus(errors: ValidationErrorLike[]): ValidationStatus {
  if (!Array.isArray(errors) || errors.length === 0) return 'valid';
  const severities = errors.map(normalizeSeverity);
  if (severities.includes('error')) return 'invalid';
  if (severities.includes('warning')) return 'warning';
  return 'info';
}

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
  
  // Cria mapa de "backend nodeId" -> nó do editor.
  // Na maioria dos casos, o backend devolve IDs numéricos do JSON do Rete ("1", "2", "3"...),
  // mas alguns validadores podem devolver aliases estáveis (ex.: "fallback_global", "end_fallback").
  // Fazemos um best-effort para resolver ambos.
  // ✅ CORREÇÃO: Garante que usamos a mesma ordem que o toJSON() usa
  // O toJSON() itera sobre editor.getNodes() usando forEach com índice
  // Precisamos garantir que usamos Array.from() para manter ordem consistente
  const engineIdToEditorNode = new Map();
  const jsonIdToEditorNode = new Map();
  const stableEngineIdToEditorNode = new Map<string, any>();
  
  // Obtém nós do editor e converte para array para garantir ordem consistente
  // Isso garante que a ordem seja a mesma que o toJSON() usa
  const nodes = Array.from(editor.getNodes());
  // ✅ Mapeamento estável: se o nó foi carregado via loadFromJson, ele terá node.data.__jsonId
  nodes.forEach((n: any) => {
    const maybeJsonId = n?.data?.__jsonId != null ? String(n.data.__jsonId) : null;
    if (maybeJsonId) {
      jsonIdToEditorNode.set(maybeJsonId, n);
    }
    const maybeEngineId = n?.data?.__engineId != null ? String(n.data.__engineId) : null;
    if (maybeEngineId) {
      stableEngineIdToEditorNode.set(maybeEngineId, n);
    }
  });

  const connections =
    typeof editor.getConnections === 'function' ? editor.getConnections() : [];

  const getNodeType = (n: any) => String(n?.data?.type || n?.type || '');

  /** @type {Map<string, any[]>} */
  const nodesByType = new Map();
  nodes.forEach((n) => {
    const t = getNodeType(n);
    if (!nodesByType.has(t)) nodesByType.set(t, []);
    nodesByType.get(t)!.push(n);
  });

  /** @type {Map<string, Set<string>>} */
  const incomingByTarget = new Map();
  for (const c of (connections || [])) {
    const source = c?.source != null ? String(c.source) : null;
    const target = c?.target != null ? String(c.target) : null;
    if (!source || !target) continue;
    if (!incomingByTarget.has(target)) incomingByTarget.set(target, new Set());
    incomingByTarget.get(target)!.add(source);
  }

  const resolveNodeByAlias = (backendNodeId: string) => {
    // Aliases conhecidos (vindos de alguns validadores/geradores)
    if (backendNodeId === 'fallback_global') {
      const fallbacks = nodesByType.get('fallback') || [];
      if (fallbacks.length === 1) return fallbacks[0];
      return null;
    }

    if (backendNodeId === 'end_fallback') {
      const fallbacks = nodesByType.get('fallback') || [];
      const ends = nodesByType.get('end') || [];

      // Caso típico: existe um fallback e um end "associado" a ele por conexão direta
      if (fallbacks.length === 1 && ends.length > 0) {
        const fb = fallbacks[0];
        const fbId = String(fb?.id || '');
        const candidates = ends.filter((e) => incomingByTarget.get(String(e.id))?.has(fbId));
        if (candidates.length === 1) return candidates[0];
      }

      // Fallback: se só houver 1 end, usa ele
      if (ends.length === 1) return ends[0];
      return null;
    }

    // Heurística genérica: prefixo antes de "_" costuma bater com type (ex: "router_xxx")
    const prefix = backendNodeId.split('_')[0];
    const byPrefixType = nodesByType.get(prefix) || [];
    if (byPrefixType.length === 1) return byPrefixType[0];

    return null;
  };

  const resolveEditorNodeForBackendId = (backendNodeIdRaw: any) => {
    const backendNodeId = String(backendNodeIdRaw);

    // 1) Caso preferido: ID do JSON persistido no nó (mapeamento determinístico)
    const directJson = jsonIdToEditorNode.get(backendNodeId);
    if (directJson) return directJson;

    // 2) Caso: ID real do engine preservado no nó (quando veio do backend)
    const directEngine = stableEngineIdToEditorNode.get(backendNodeId);
    if (directEngine) return directEngine;

    // 3) Fallback: IDs numéricos do JSON Rete ("1", "2"...), via ordem do editor
    const direct = engineIdToEditorNode.get(backendNodeId);
    if (direct) return direct;

    // 4) Caso alternativo: aliases estáveis ("fallback_global", "end_fallback"...)
    return resolveNodeByAlias(backendNodeId);
  };
  
  // Cria mapeamento: para cada nó, calcula qual seria seu ID no JSON Rete
  // Segue a mesma lógica de toJSON() em createEditor.js (linha 112-115)
  nodes.forEach((node, index) => {
    const jsonId = String(index + 1); // ID no JSON Rete (1, 2, 3...)
    engineIdToEditorNode.set(jsonId, node);
  });
  
  logger.debug('applyBackendValidationErrors - mapeamento criado', {
    totalNodes: nodes.length,
    mappedIds: Array.from(engineIdToEditorNode.keys()),
    mappedJsonIds: Array.from(jsonIdToEditorNode.keys()),
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
        node.data.validation.status = computeStatus(remainingErrors);
        
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
      const editorNode = resolveEditorNodeForBackendId(engineId);
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

        // ✅ status deve refletir severidade (warning ≠ inválido)
        editorNode.data.validation.status = computeStatus(editorNode.data.validation.errors as ValidationErrorLike[]);
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
      const connsFromNode = (connections || []).filter(
        (c: any) => c && String(c.source) === String(node.id),
      );

      // Agrupa por porta de saída (sourceOutput) para preservar semântica do modelo da engine:
      // - se houver apenas `out`, usamos string/array
      // - se houver múltiplas portas (fallback, limit_exceeded, etc.), usamos port-map
      const targetsByOutput = new Map<string, string[]>();
      for (const c of connsFromNode) {
        const outKey = c?.sourceOutput != null ? String(c.sourceOutput) : 'out';
        const target = c?.target != null ? String(c.target) : null;
        if (!target) continue;
        if (!targetsByOutput.has(outKey)) targetsByOutput.set(outKey, []);
        // dedup por porta
        const arr = targetsByOutput.get(outKey)!;
        if (!arr.includes(target)) arr.push(target);
      }

      const nextKeys = Array.from(targetsByOutput.keys()).filter((k) => (targetsByOutput.get(k) || []).length > 0);
      let next: any = null;
      if (nextKeys.length === 1 && nextKeys[0] === 'out') {
        const outs = targetsByOutput.get('out') || [];
        next = outs.length === 1 ? outs[0] : outs;
      } else if (nextKeys.length > 0) {
        const nextMap: Record<string, any> = {};
        for (const k of nextKeys) {
          const outs = targetsByOutput.get(k) || [];
          nextMap[k] = outs.length === 1 ? outs[0] : outs;
        }
        next = nextMap;
      }

      // Adapta nó do Rete para o formato esperado pelos schemas (engine-like)
      const plainNode = {
        id: String(node.id),
        type: nodeType,
        config: (node?.data?.config && typeof node.data.config === 'object') ? node.data.config : {},
        next,
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
        status: computeStatus(mergedErrors),
        errors: mergedErrors,
      };
      
      // ✅ Usa area.update() para forçar re-render do React (padrão do Rete.js v2)
      // Isso garante que a classe CSS (error/warning/info) seja aplicada
      // Referência: https://github.com/retejs/reference/blob/main/src/rete/default.ts#L191
      if (area && typeof area.update === 'function') {
        try {
          area.update('node', node.id);
        } catch (err) {
          logger.warn('Erro ao atualizar nó via area.update', { nodeId: node.id, error: err });
        }
      }
      
      if (mergedErrors.length > 0) {
        logger.debug('runFlowValidation - nó com issues de validação', {
          nodeId: node.id,
          nodeType,
          errorCount: mergedErrors.length,
          status: node.data.validation.status,
          errors: mergedErrors,
        });
      }
    }
    
    logger.debug('runFlowValidation - validação concluída', {
      nodeCount: nodes.length,
      invalidCount: nodes.filter(n => n.data?.validation?.status === 'invalid').length,
    });
  }