import React, { useState, useEffect } from 'react';
import { getAllTags, getAllCategories, filterTickets, getSegmentationStats } from '../api/segmentation';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

export function SegmentationPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  
  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);
  
  const [tags, setTags] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [filters, setFilters] = useState({
    tags: '',
    category: '',
    status: '',
    queue: '',
    search: '',
  });

  useEffect(() => {
    loadTagsAndCategories();
  }, []);

  useEffect(() => {
    if (Object.values(filters).some(v => v)) {
      loadFilteredData();
    }
  }, [filters]);

  const loadTagsAndCategories = async () => {
    try {
      const [tagsData, categoriesData] = await Promise.all([
        getAllTags(),
        getAllCategories(),
      ]);
      setTags(tagsData.tags || []);
      setCategories(categoriesData.categories || []);
    } catch (error) {
      logger.error('Erro ao carregar tags e categorias:', error);
    }
  };

  const loadFilteredData = async () => {
    setLoading(true);
    try {
      const tagsArray = filters.tags ? filters.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined;
      
      const [ticketsData, statsData] = await Promise.all([
        filterTickets({
          ...filters,
          tags: tagsArray,
        }),
        getSegmentationStats({
          ...filters,
          tags: tagsArray,
        }),
      ]);
      
      setTickets(ticketsData.tickets || []);
      setStats(statsData);
    } catch (error) {
      logger.error('Erro ao filtrar tickets:', error);
      showToast('Erro ao filtrar tickets', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <CrudPageBase>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🎯 Segmentação</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Tags, categorias e filtros avançados
        </p>
      
        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

        {/* Filtros */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
            <span>🔍</span>
            <span>Filtros</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Tags (separadas por vírgula)
              </label>
              <input
                value={filters.tags}
                onChange={(e) => setFilters({ ...filters, tags: e.target.value })}
                placeholder="Ex: urgente, importante"
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Categoria
              </label>
              <select
                value={filters.category}
                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
              >
                <option value="">Todas</option>
                {categories.map(cat => (
                  <option key={cat.category} value={cat.category}>
                    {cat.category} ({cat.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
              >
                <option value="">Todos</option>
                <option value="waiting">Esperando</option>
                <option value="in_progress">Em Andamento</option>
                <option value="closed">Fechado</option>
              </select>
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Buscar
              </label>
              <input
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Buscar por texto..."
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>

        {/* Estatísticas */}
        {stats && (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Estatísticas
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-text-secondary">Total de Tickets</div>
                <div className="text-2xl font-bold text-text-primary">
                  {stats.totalTickets}
                </div>
              </div>
              {stats.topTags && stats.topTags.length > 0 && (
                <div>
                  <div className="text-sm text-text-secondary mb-2">Top Tags</div>
                  <div className="space-y-1">
                    {stats.topTags.slice(0, 3).map(tag => (
                      <div key={tag.tag} className="text-sm">
                        <span className="text-text-primary">{tag.tag}</span>
                        <span className="text-text-tertiary ml-2">({tag.count})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Lista de Tags e Categorias */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Tags Disponíveis
            </h2>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <span
                  key={tag.tag}
                  className="px-3 py-1 bg-accent-light text-accent-primary rounded-full text-sm"
                >
                  {tag.tag} ({tag.count})
                </span>
              ))}
            </div>
          </div>
          
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Categorias Disponíveis
            </h2>
            <div className="space-y-2">
              {categories.map(cat => (
                <div
                  key={cat.category}
                  className="flex justify-between items-center p-2 bg-bg-secondary rounded-lg"
                >
                  <span className="text-text-primary">{cat.category}</span>
                  <span className="text-text-tertiary">{cat.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tickets Filtrados */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-text-secondary">Carregando...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
            <p className="text-text-secondary">
              {Object.values(filters).some(v => v) 
                ? 'Nenhum ticket encontrado com os filtros aplicados'
                : 'Aplique filtros para ver tickets'}
            </p>
          </div>
        ) : (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Tickets Encontrados ({tickets.length})
            </h2>
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="border border-border-default rounded-xl p-4 bg-bg-secondary"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-semibold text-text-primary">
                        {ticket.phoneNumber || ticket.sessionId}
                      </div>
                      <div className="text-sm text-text-secondary">
                        {ticket.queue} • {ticket.status}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      ticket.status === 'closed' ? 'bg-status-success/20 text-status-success' :
                      ticket.status === 'in_progress' ? 'bg-status-info/20 text-status-info' :
                      'bg-status-warning/20 text-status-warning'
                    }`}>
                      {ticket.status}
                    </span>
                  </div>
                  {ticket.lastUserMessage && (
                    <p className="text-text-secondary text-sm mb-2">
                      {ticket.lastUserMessage}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {ticket.tags?.map(tag => (
                      <span
                        key={tag}
                        className="px-2 py-1 bg-accent-light text-accent-primary text-xs rounded"
                      >
                        {tag}
                      </span>
                    ))}
                    {ticket.category && (
                      <span className="px-2 py-1 bg-status-info/20 text-status-info text-xs rounded">
                        {ticket.category}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      <ToastContainer />
    </CrudPageBase>
  );
}

