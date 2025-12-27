/**
 * Validação preventiva seguindo padrão da documentação oficial do Rete.js
 * Bloqueia ações inválidas ANTES de acontecerem
 * 
 * Referência: https://retejs.org/docs/guides/validation/
 */

/**
 * Verifica se pode criar um nó do tipo especificado
 * 
 * @param {any} editor - Instância do editor Rete.js
 * @param {string} nodeType - Tipo do nó a ser criado
 * @returns {{ allowed: boolean, message?: string }}
 */
export function canCreateNode(editor: any, nodeType: string): { allowed: boolean; message?: string } {
  if (!editor || !nodeType) {
    return { allowed: true };
  }

  // Previne criação de nó 'end' sem nó 'start'
  if (nodeType === 'end') {
    const nodes = editor.getNodes();
    const hasStartNode = nodes.some((n: any) => n.type === 'start');
    
    if (!hasStartNode) {
      return {
        allowed: false,
        message: 'Não é possível adicionar nó End sem um nó Start. Adicione um nó Start primeiro.'
      };
    }
  }

  // Previne múltiplos nós 'start'
  if (nodeType === 'start') {
    const nodes = editor.getNodes();
    const hasStartNode = nodes.some((n: any) => n.type === 'start');
    
    if (hasStartNode) {
      return {
        allowed: false,
        message: 'O fluxo já possui um nó Start. Apenas um nó Start é permitido por fluxo.'
      };
    }
  }

  return { allowed: true };
}

/**
 * Verifica se pode criar uma conexão entre dois nós
 * 
 * @param {any} editor - Instância do editor Rete.js
 * @param {any} connection - Objeto de conexão com source e target
 * @returns {{ allowed: boolean, message?: string }}
 */
export function canCreateConnection(editor: any, connection: any): { allowed: boolean; message?: string } {
  if (!editor || !connection) {
    return { allowed: true };
  }

  // Tenta obter os nós de diferentes formas:
  // 1. Se connection.source/target são objetos Node diretamente (caso do loadFromJson)
  // 2. Se são IDs, busca usando editor.getNode()
  let sourceNode = null;
  let targetNode = null;

  // Verifica se source/target são objetos Node (têm propriedade 'id' e 'data')
  if (connection.source && typeof connection.source === 'object' && connection.source.id) {
    sourceNode = connection.source;
  } else if (connection.source) {
    sourceNode = editor.getNode(connection.source);
  }

  if (connection.target && typeof connection.target === 'object' && connection.target.id) {
    targetNode = connection.target;
  } else if (connection.target) {
    targetNode = editor.getNode(connection.target);
  }

  if (!sourceNode || !targetNode) {
    return {
      allowed: false,
      message: 'Nós não encontrados para criar conexão.'
    };
  }

  // Regras de compatibilidade de tipos (mesmas da engine)
  const TYPE_COMPATIBILITY: Record<string, string[]> = {
    start: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
    message: ['user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
    user_input: ['router', 'message', 'set_variable', 'handoff', 'ai', 'end'],
    router: ['message', 'user_input', 'set_variable', 'handoff', 'ai', 'end'],
    set_variable: ['message', 'user_input', 'router', 'handoff', 'ai', 'end'],
    ai: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'end'],
    handoff: ['end'],
    end: [],
  };

  const sourceType = sourceNode.type || 'unknown';
  const targetType = targetNode.type || 'unknown';

  // Se o tipo não está no mapa, permite (genérico)
  if (!TYPE_COMPATIBILITY[sourceType]) {
    return { allowed: true };
  }

  const allowedTargets = TYPE_COMPATIBILITY[sourceType] || [];
  if (!allowedTargets.includes(targetType)) {
    return {
      allowed: false,
      message: `Não é permitido conectar "${sourceType}" → "${targetType}". Tipos incompatíveis.`
    };
  }

  return { allowed: true };
}

