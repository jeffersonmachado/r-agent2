/**
 * Utilitários para o DevDashboard
 */

/**
 * Formata tempo em minutos para texto legível
 */
export const formatTime = (minutes) => {
  if (!minutes || minutes === 0) return 'N/A';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}min`;
};

/**
 * Formata número com separador de milhar
 */
export const formatNumber = (num) => {
  if (num === null || num === undefined) return '0';
  return num.toLocaleString('pt-BR');
};

/**
 * Formata JSON
 */
export const formatJSON = (content) => {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content; // Retorna original se não for JSON válido
  }
};

/**
 * Escapa HTML
 */
export const escapeHTML = (str) => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Verifica se é JSON
 */
export const isJSON = (content) => {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
};

/**
 * Formata JSON com syntax highlighting básico
 */
export const formatJSONContent = (content, theme) => {
  if (!content) return '';
  
  try {
    const formatted = formatJSON(content);
    const isDark = theme.name === 'dark';
    
    // Cores para syntax highlighting
    const colors = {
      key: isDark ? '#79b8ff' : '#0066cc',
      string: isDark ? '#9ecbff' : '#008000',
      number: isDark ? '#79b8ff' : '#0000ff',
      boolean: isDark ? '#ffab70' : '#0000ff',
      null: isDark ? '#ffab70' : '#808080',
      punctuation: isDark ? '#d4d4d4' : '#000000',
    };

    // Processa o JSON formatado linha por linha para aplicar cores
    const lines = formatted.split('\n');
    const highlighted = lines.map(line => {
      let escaped = escapeHTML(line);
      
      // Aplica cores - chaves (antes do :)
      escaped = escaped.replace(/(&quot;[^&]*&quot;)\s*:/g, (match, key) => {
        return `<span style="color: ${colors.key}">${key}</span>:`;
      });
      
      // Valores string (depois do :)
      escaped = escaped.replace(/:\s*(&quot;[^&]*&quot;)/g, (match, value) => {
        return `: <span style="color: ${colors.string}">${value}</span>`;
      });
      
      // Números
      escaped = escaped.replace(/:\s*(\d+\.?\d*)/g, (match, value) => {
        return `: <span style="color: ${colors.number}">${value}</span>`;
      });
      
      // Booleanos
      escaped = escaped.replace(/:\s*(true|false)/g, (match, value) => {
        return `: <span style="color: ${colors.boolean}">${value}</span>`;
      });
      
      // Null
      escaped = escaped.replace(/:\s*(null)/g, (match, value) => {
        return `: <span style="color: ${colors.null}">${value}</span>`;
      });
      
      // Pontuação (chaves, colchetes)
      escaped = escaped.replace(/([{}[\]])/g, (match) => {
        return `<span style="color: ${colors.punctuation}">${match}</span>`;
      });
      
      return escaped;
    });
    
    return highlighted.join('<br/>');
  } catch {
    // Se não conseguir formatar, retorna o conteúdo original escapado
    return escapeHTML(content).replace(/\n/g, '<br/>');
  }
};

/**
 * Obtém cor do status baseado no tema
 */
export const getStatusColor = (status, theme) => {
  const isDark = theme.name === 'dark';
  switch (status) {
    case 'healthy':
      return isDark 
        ? 'text-status-success bg-status-success/10 border-status-success/30'
        : 'text-status-success bg-green-50 border-green-200';
    case 'degraded':
      return isDark
        ? 'text-status-warning bg-status-warning/10 border-status-warning/30'
        : 'text-status-warning bg-yellow-50 border-yellow-200';
    case 'unhealthy':
      return isDark
        ? 'text-status-error bg-status-error/10 border-status-error/30'
        : 'text-status-error bg-red-50 border-red-200';
    default:
      return isDark
        ? 'text-text-secondary bg-bg-elevated border-border-default'
        : 'text-text-secondary bg-gray-50 border-gray-200';
  }
};

/**
 * Obtém ícone do status
 */
export const getStatusIcon = (status) => {
  switch (status) {
    case 'healthy':
      return '✓';
    case 'degraded':
      return '⚠';
    case 'unhealthy':
      return '✗';
    default:
      return '?';
  }
};

/**
 * Informações de arquivos de contrato
 */
export const getFileInfo = (name) => {
  if (name.includes('generation.interface')) return { icon: '⚙️', desc: 'Interface de geração de fluxos', color: '#3b82f6' };
  if (name.includes('ia-generation-result')) return { icon: '🤖', desc: 'Schema de resultado de geração IA', color: '#8b5cf6' };
  if (name.includes('ia-public-interface')) return { icon: '🔌', desc: 'Interface pública de IA', color: '#8b5cf6' };
  if (name.includes('qa-result')) return { icon: '✅', desc: 'Schema de resultado de QA', color: '#10b981' };
  if (name.includes('qa.contract')) return { icon: '📊', desc: 'Contrato de QA', color: '#10b981' };
  if (name.includes('system.bootstrap')) return { icon: '🚀', desc: 'Configuração de inicialização', color: '#f59e0b' };
  if (name.includes('versions')) return { icon: '📌', desc: 'Controle de versões', color: '#6b7280' };
  return { icon: '📄', desc: 'Contrato de sistema', color: '#6b7280' };
};

/**
 * Informações de arquivos de prompt
 */
export const getPromptInfo = (name) => {
  if (name.includes('rag.guardrails')) return { icon: '🛡️', desc: 'Regras de segurança para geração controlada', color: '#ef4444' };
  if (name.includes('chatbot.generator')) return { icon: '💬', desc: 'Geração de fluxos de chatbot', color: '#3b82f6' };
  if (name.includes('rpa.generator')) return { icon: '🤖', desc: 'Geração de testes RPA automatizados', color: '#f59e0b' };
  if (name.includes('cursor.execution')) return { icon: '⚡', desc: 'Regras de execução no Cursor IDE', color: '#8b5cf6' };
  if (name.includes('README')) return { icon: '📖', desc: 'Documentação dos prompts', color: '#6b7280' };
  return { icon: '📝', desc: 'Documento de sistema', color: '#6b7280' };
};

/**
 * Informações de arquivos de nós
 */
export const getNodeFileInfo = (name, path) => {
  if (path.includes('nodes/node.types')) return { icon: '🔧', desc: 'Tipos de nós disponíveis (core e system)', color: '#3b82f6', category: 'Tipos' };
  if (path.includes('schema/flow.schema')) return { icon: '📐', desc: 'Schema JSON dos fluxos', color: '#8b5cf6', category: 'Schema' };
  if (path.includes('rules/connection.rules')) return { icon: '🔗', desc: 'Regras de conexão entre nós', color: '#10b981', category: 'Regras' };
  if (path.includes('known_errors/flow.errors')) return { icon: '⚠️', desc: 'Erros conhecidos dos fluxos', color: '#f59e0b', category: 'Erros' };
  return { icon: '📄', desc: 'Arquivo de configuração de nós', color: '#6b7280', category: 'Outros' };
};

/**
 * Ícones de categorias de documentos
 */
export const getCategoryIcon = (categoryName) => {
  const categoryIcons = {
    'Analises': '📊',
    'Implementacoes': '🔧',
    'Resumos Relatorios': '📄',
    'Testes': '🧪',
    'RPA': '🤖',
    'RAG': '🔍',
    'Guias Tutoriais': '📖',
    'Documentacao API': '🔌',
    'Configuracao': '⚙️',
    'Politicas Governanca': '🛡️',
    'Prompts': '💬',
    'Frontend': '🎨',
    'Servicos': '🔄',
    'Infraestrutura': '🏗️',
    'Regras Projeto': '📜',
    'Outros': '📦',
  };
  return categoryIcons[categoryName] || '📁';
};

/**
 * Configuração das tabs
 */
export const TABS = [
  { id: 'status', label: '📊 Status', icon: '📊' },
  { id: 'features', label: '🚀 Funcionalidades', icon: '🚀' },
  { id: 'metrics', label: '📈 Métricas', icon: '📈' },
  { id: 'environment', label: '⚙️ Ambiente', icon: '⚙️' },
  { id: 'rate-limit', label: '🚦 Rate Limit', icon: '🚦' },
  { id: 'websocket', label: '🔌 WebSocket', icon: '🔌' },
  { id: 'contracts-prompts', label: '📋 Contratos', icon: '📋' },
  { id: 'documents', label: '📚 Documentos', icon: '📚' },
  { id: 'nodes', label: '🔧 Nós dos Fluxos', icon: '🔧' },
  { id: 'tools', label: '🛠️ Ferramentas', icon: '🛠️' },
];

/**
 * Funcionalidades de desenvolvimento
 */
export const DEV_FEATURES = [
  {
    id: 'rpa-test',
    title: 'Execução de Testes RPA',
    description: 'Execute testes RPA automatizados (apenas desenvolvimento)',
    icon: '🚀',
    path: '/rpa-test',
    color: 'bg-orange-600',
    category: 'RPA',
  },
  {
    id: 'rpa-replays',
    title: 'Replays RPA',
    description: 'Visualize e analise replays de execuções RPA (apenas desenvolvimento)',
    icon: '📋',
    path: '/rpa-replays',
    color: 'bg-pink-600',
    category: 'RPA',
  },
  {
    id: 'qa-waves',
    title: 'QA Waves',
    description: 'Monitore ondas, jornadas e replays QA integrados',
    icon: '🌊',
    path: '/dev/qa-waves',
    color: 'bg-cyan-600',
    category: 'QA',
  },
];

