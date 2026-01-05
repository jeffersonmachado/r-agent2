import React, { useState, useMemo } from 'react';
import { useRouter } from '../hooks/useRouter';
import { useAuth } from '../context/authContext';
import { NavigationLink } from '../components/NavigationLink';

/**
 * Página Dashboard - Hub central com todas as funcionalidades
 */
export function DashboardPage() {
  const { navigate } = useRouter();
  const { agent } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const features = [
    {
      id: 'support',
      title: 'Atendimento',
      description: 'Gerencie tickets e conversas com clientes',
      icon: '💬',
      path: '/support',
      color: 'bg-blue-500',
      category: 'Atendimento',
    },
    {
      id: 'quick-replies',
      title: 'Respostas Rápidas',
      description: 'Mensagens pré-definidas e templates',
      icon: '⚡',
      path: '/quick-replies',
      color: 'bg-green-500',
      category: 'Atendimento',
    },
    {
      id: 'departments',
      title: 'Departamentos',
      description: 'Organize equipe em departamentos',
      icon: '🏢',
      path: '/departments',
      color: 'bg-indigo-500',
      category: 'Organização',
    },
    {
      id: 'bulk-messaging',
      title: 'Disparos em Massa',
      description: 'Envie mensagens para múltiplos contatos',
      icon: '📢',
      path: '/bulk-messaging',
      color: 'bg-yellow-500',
      category: 'Marketing',
    },
    {
      id: 'analytics',
      title: 'Analytics & Métricas',
      description: 'Dashboard com KPIs e indicadores',
      icon: '📊',
      path: '/analytics',
      color: 'bg-red-500',
      category: 'Analytics',
    },
    {
      id: 'export',
      title: 'Exportação',
      description: 'Exporte dados em CSV e JSON',
      icon: '📥',
      path: '/export',
      color: 'bg-teal-500',
      category: 'Analytics',
    },
    {
      id: 'ai-tools',
      title: 'Ferramentas de IA',
      description: 'Sugestões de resposta e reescrita inteligente',
      icon: '🤖',
      path: '/ai-tools',
      color: 'bg-pink-500',
      category: 'IA',
    },
    {
      id: 'segmentation',
      title: 'Segmentação',
      description: 'Tags, categorias e filtros avançados',
      icon: '🏷️',
      path: '/segmentation',
      color: 'bg-orange-500',
      category: 'Organização',
    },
    {
      id: 'whatsapp-templates',
      title: 'Templates WhatsApp',
      description: 'Gerencie templates do WhatsApp Business API',
      icon: '📋',
      path: '/whatsapp-templates',
      color: 'bg-emerald-500',
      category: 'Integração',
    },
    {
      id: 'dev-dashboard',
      title: 'Dashboard de Dev',
      description: 'Ferramentas, configurações e funcionalidades de desenvolvimento',
      icon: '🛠️',
      path: '/dev',
      color: 'bg-indigo-600',
      category: 'Desenvolvimento',
    },
    {
      id: 'config',
      title: 'Configurações',
      description: 'Configurações do sistema',
      icon: '⚙️',
      path: '/config',
      color: 'bg-slate-500',
      category: 'Administração',
    },
    {
      id: 'agents',
      title: 'Agentes',
      description: 'Gerencie agentes e permissões',
      icon: '👥',
      path: '/agents',
      color: 'bg-cyan-500',
      category: 'Administração',
    },
    {
      id: 'audit',
      title: 'Auditoria',
      description: 'Logs e histórico de ações',
      icon: '📝',
      path: '/audit',
      color: 'bg-gray-500',
      category: 'Administração',
    },
    {
      id: 'knowledge-base',
      title: 'Base de Conhecimento',
      description: 'Gerencie artigos e FAQs para RAG',
      icon: '📚',
      path: '/knowledge-base',
      color: 'bg-blue-600',
      category: 'RAG',
    },
    {
      id: 'product-docs',
      title: 'Documentação de Produtos',
      description: 'Documentação técnica de produtos',
      icon: '📦',
      path: '/product-docs',
      color: 'bg-amber-600',
      category: 'RAG',
    },
    {
      id: 'rag-documents',
      title: 'Documentos RAG',
      description: 'Gerencie todos os documentos indexados',
      icon: '🔍',
      path: '/rag-documents',
      color: 'bg-violet-600',
      category: 'RAG',
    },
    {
      id: 'web-scraping',
      title: 'Raspagem de Sites',
      description: 'Extraia conteúdo de sites e indexe no RAG',
      icon: '🕷️',
      path: '/web-scraping',
      color: 'bg-emerald-600',
      category: 'RAG',
    },
    {
      id: 'system-status',
      title: 'Status do Sistema',
      description: 'Monitoramento de serviços e saúde do sistema',
      icon: '💚',
      path: '/system-status',
      color: 'bg-green-600',
      category: 'Monitoramento',
    },
    {
      id: 'editor',
      title: 'Editor de Fluxos',
      description: 'Crie e edite fluxos de conversação',
      icon: '🔀',
      path: '/editor',
      color: 'bg-purple-500',
      category: 'Desenvolvimento',
    },
    {
      id: 'rpa-seeds',
      title: 'Seeds RPA',
      description: 'Visualize e reproduza seeds de /tests/rpa/seeds/',
      icon: '🌱',
      path: '/rpa-seeds',
      color: 'bg-lime-600',
      category: 'RPA',
    },
    {
      id: 'chat',
      title: 'Chat de Teste',
      description: 'Teste fluxos através de interface de chat',
      icon: '💬',
      path: '/chat',
      color: 'bg-green-600',
      category: 'Testes',
    },
    {
      id: 'qa',
      title: 'Painel de Qualidade (QA)',
      description: 'Ferramentas de qualidade e validação',
      icon: '✅',
      path: '/qa',
      color: 'bg-teal-600',
      category: 'Qualidade',
    },
    {
      id: 'generate-system',
      title: 'Gerar Sistema',
      description: 'Gere fluxos, RPA e seeds automaticamente',
      icon: '🎯',
      path: '/generate-system',
      color: 'bg-indigo-600',
      category: 'Geração',
    },
  ];

  // Extrai categorias únicas
  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(features.map(f => f.category))];
    return uniqueCategories.sort();
  }, []);

  // Filtra features baseado na busca e categoria e ordena alfabeticamente
  const filteredFeatures = useMemo(() => {
    const filtered = features.filter(feature => {
      const matchesSearch = !searchTerm || 
        feature.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        feature.description.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = !selectedCategory || feature.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });
    
    // Ordena alfabeticamente por título
    return filtered.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  }, [searchTerm, selectedCategory]);

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📊 Dashboard</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Bem-vindo, {agent?.name || agent?.username}! Acesse todas as funcionalidades do sistema.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por título ou descrição..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Categoria
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todas as categorias</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Resumo dos filtros */}
        {(searchTerm || selectedCategory) && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-sm text-text-secondary">
              Mostrando <strong>{filteredFeatures.length}</strong> de <strong>{features.length}</strong> funcionalidade(s)
              {searchTerm && ` contendo "${searchTerm}"`}
              {selectedCategory && ` na categoria "${selectedCategory}"`}
            </p>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('');
              }}
              className="mt-2 text-sm text-accent-primary hover:text-accent-hover"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredFeatures.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
            <p className="text-text-secondary">Nenhuma funcionalidade encontrada com os filtros aplicados</p>
          </div>
        ) : (
          filteredFeatures.map((feature) => (
            <NavigationLink
              key={feature.id}
              to={feature.path}
              className="block"
            >
              <div className="bg-bg-elevated rounded-xl border border-border-default hover:shadow-lg transition-shadow p-6 cursor-pointer">
                <div className="flex items-start justify-between mb-3">
                  <div className={`${feature.color} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
                    {feature.icon}
                  </div>
                  <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">
                    {feature.category}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-text-primary mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-text-secondary">
                  {feature.description}
                </p>
              </div>
            </NavigationLink>
          ))
        )}
        </div>

        <div className="mt-12 bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            Funcionalidades Implementadas
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-text-primary mb-2">✅ Completas</h3>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• Respostas Rápidas (Quick Replies)</li>
                <li>• Departamentos</li>
                <li>• Disparos em Massa</li>
                <li>• Dashboard de Análise</li>
                <li>• Exportação de Dados</li>
                <li>• Sugestão de Resposta (IA)</li>
                <li>• Reescrita Inteligente (IA)</li>
                <li>• Transcrição de Áudio</li>
                <li>• Facebook Messenger</li>
                <li>• Instagram Direct</li>
                <li>• Segmentação Avançada</li>
                <li>• Templates WhatsApp Business API</li>
                <li>• Documentação da API</li>
                <li>• Base de Conhecimento (RAG)</li>
                <li>• Documentação de Produtos (RAG)</li>
                <li>• Gerenciamento de Documentos RAG</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-text-primary mb-2">🔗 Integrações</h3>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• WhatsApp Business API</li>
                <li>• Facebook Messenger</li>
                <li>• Instagram Direct</li>
                <li>• OpenAI (Whisper, GPT)</li>
                <li>• RAG Service (Python FastAPI)</li>
                <li>• FAISS Vector Store</li>
              </ul>
            </div>
          </div>
        </div>
    </div>
  );
}

