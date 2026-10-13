import React, { useState, useEffect, useMemo } from 'react';
import { getFlowTemplates, createFlowFromTemplate, clearTemplatesCache, deleteTemplate, installFlowFromTemplate } from '../templates/flowTemplates';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { Dialog } from './Dialog';
import { ConfirmDialog } from './ConfirmDialog';
import logger from '../utils/logger';

/**
 * Seletor de modelos de fluxo para criar novos fluxos
 */
export function FlowTemplateSelector({ onTemplateSelected, onCancel, refreshTrigger = 0 }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [customName, setCustomName] = useState('');
  const [customId, setCustomId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all'); // all | global | tenant
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const safeStringify = (obj, maxLen = 12000) => {
    try {
      const s = JSON.stringify(obj, null, 2);
      if (typeof s !== 'string') return '';
      return s.length > maxLen ? `${s.slice(0, maxLen)}\n…` : s;
    } catch {
      return '';
    }
  };

  // Carrega templates ao montar o componente ou quando refreshTrigger mudar
  useEffect(() => {
    async function loadTemplates() {
      try {
        setLoading(true);
        setError(null);
        // Sempre limpa o cache quando o trigger mudar (indica que um novo template foi salvo)
        // Isso garante que a lista seja sempre atualizada
        clearTemplatesCache();
        const loadedTemplates = await getFlowTemplates();
        setTemplates(loadedTemplates);
        logger.info('Templates carregados no seletor', { count: loadedTemplates.length, refreshTrigger });
      } catch (err) {
        logger.error('Erro ao carregar templates', err);
        setError('Erro ao carregar templates. Tente recarregar a página.');
      } finally {
        setLoading(false);
      }
    }
    loadTemplates();
  }, [refreshTrigger]);

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setCustomName(`${template.name} (cópia)`);
    setCustomId('');
  };

  const handleCreate = async () => {
    logger.info('Botão Criar Fluxo clicado', { 
      hasTemplate: !!selectedTemplate,
      templateId: selectedTemplate?.id,
      customId,
      customName 
    });
    
    if (!selectedTemplate) {
      logger.warn('Tentativa de criar fluxo sem template selecionado');
      return;
    }

    setCreating(true);
    try {
      logger.debug('Instalando fluxo do template', { 
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name 
      });

      const flow = await installFlowFromTemplate(
        selectedTemplate,
        customId || undefined,
        customName || undefined,
      );

      logger.info('Fluxo instalado do template', { 
        flowId: flow?.id,
        flowName: flow?.name,
        nodeCount: flow?.nodes?.length || flow?.data?.nodes?.length || 0
      });

      if (onTemplateSelected) {
        logger.debug('Chamando onTemplateSelected callback', { flowId: flow?.id });
        onTemplateSelected(flow);
      } else {
        logger.error('onTemplateSelected não está definido!');
      }
    } catch (err) {
      logger.error('Erro ao instalar fluxo do template, usando fallback local', err);
      const flow = createFlowFromTemplate(
        selectedTemplate,
        customId || undefined,
        customName || undefined,
      );
      if (onTemplateSelected) {
        onTemplateSelected(flow);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = () => {
    setSelectedTemplate(null);
    setCustomName('');
    setCustomId('');
    if (onCancel) {
      onCancel();
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError(null);
      clearTemplatesCache();
      const loadedTemplates = await getFlowTemplates();
      setTemplates(loadedTemplates);
      setFilterText(''); // Limpa o filtro ao atualizar
      logger.info('Templates atualizados manualmente', { count: loadedTemplates.length });
    } catch (err) {
      logger.error('Erro ao atualizar templates', err);
      setError('Erro ao atualizar templates. Tente novamente.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteClick = (e, template) => {
    e.stopPropagation(); // Previne que o clique no botão selecione o template
    setTemplateToDelete(template);
  };

  const handleConfirmDelete = async () => {
    if (!templateToDelete) return;

    try {
      setDeleting(true);
      setError(null);
      await deleteTemplate(templateToDelete.id);
      
      // Limpa o cache e recarrega a lista de templates
      clearTemplatesCache();
      const loadedTemplates = await getFlowTemplates();
      setTemplates(loadedTemplates);
      
      logger.info('Template removido e lista atualizada', { templateId: templateToDelete.id });
    } catch (err) {
      logger.error('Erro ao remover template', err);
      setError(`Erro ao remover template: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setDeleting(false);
      setTemplateToDelete(null);
    }
  };

  // Tags disponíveis para filtro.
  //
  // REGRA DE HOOKS: este `useMemo` PRECISA ficar antes dos `return` antecipados
  // (`selectedTemplate`, `loading`, `error`). Ele estava DEPOIS deles e, na
  // primeira renderização, `loading === true` retornava antes de chegar aqui; ao
  // terminar o fetch, a render seguinte chamava UM HOOK A MAIS que a anterior e o
  // React abortava o componente:
  //   "Rendered more hooks than during the previous render"
  //   "React has detected a change in the order of Hooks called by FlowTemplateSelector"
  // Efeito medido no browser (jornada funcional de 2026-10-13): a tela `/editor`
  // registrava 2 erros de console + 3 pageerror e o botão "Novo" não abria o
  // seletor de modelos — a tela ficava sem a ação de criar fluxo.
  const availableTags = useMemo(() => {
    const set = new Set();
    for (const t of templates) {
      for (const tag of (t.tags || [])) set.add(tag);
    }
    return Array.from(set).sort();
  }, [templates]);

  if (selectedTemplate) {
    return (
      <Dialog
        isOpen={true}
        onClose={handleCancel}
        title={`Criar fluxo: ${selectedTemplate.name}`}
        size="md"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              Nome do fluxo
            </div>
            <Input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={selectedTemplate.name}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              ID do fluxo (opcional)
            </div>
            <Input
              type="text"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              placeholder="Deixe vazio para gerar automaticamente"
              className="w-full font-mono text-xs"
            />
          </div>

          <div className="text-xs text-text-secondary p-3 bg-bg-tertiary rounded-md">
            {selectedTemplate.description}
          </div>

          {Array.isArray(selectedTemplate.tags) && selectedTemplate.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedTemplate.tags.map((t) => (
                <span key={t} className="px-2 py-1 text-[11px] rounded-full bg-bg-tertiary border border-border-default text-text-secondary">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="text-[11px] text-text-tertiary">
            Prévia: {selectedTemplate.flow?.nodes?.length || selectedTemplate.flow?.data?.nodes?.length || 0} nós
          </div>

          <details className="text-xs text-text-secondary">
            <summary className="cursor-pointer text-text-tertiary">
              Ver preview do fluxo (JSON)
            </summary>
            <pre className="mt-2 p-3 bg-bg-tertiary rounded-md border border-border-default overflow-auto max-h-[280px] text-[11px] text-text-secondary">
              {safeStringify(selectedTemplate.flow) || '[sem preview]'}
            </pre>
          </details>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="ghost" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCreate} disabled={creating}>
              {creating ? 'Criando...' : 'Criar Fluxo'}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (loading) {
    return (
      <Dialog
        isOpen={true}
        onClose={handleCancel}
        title="Criar Novo Fluxo"
        size="xl"
      >
        <div className="text-center p-8">
          <div className="text-text-secondary">Carregando templates...</div>
        </div>
      </Dialog>
    );
  }

  if (error) {
    return (
      <Dialog
        isOpen={true}
        onClose={handleCancel}
        title="Criar Novo Fluxo"
        size="xl"
      >
        <div className="text-center p-8">
          <div className="text-red-500 mb-4">{error}</div>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Recarregar Página
          </Button>
        </div>
      </Dialog>
    );
  }

  // Filtra templates baseado no texto de busca
  const filteredTemplates = templates.filter((template) => {
    const matchesTag = tagFilter ? (template.tags || []).includes(tagFilter) : true;
    const matchesScope = scopeFilter === 'all'
      ? true
      : (scopeFilter === 'global'
        ? (template.tenantId === 'system' || template.scope === 'global')
        : (template.tenantId && template.tenantId !== 'system'));
    if (!filterText.trim()) {
      return matchesTag && matchesScope;
    }
    const searchText = filterText.toLowerCase();
    const matchesText = (
      template.name.toLowerCase().includes(searchText) ||
      template.description.toLowerCase().includes(searchText) ||
      (template.id && template.id.toLowerCase().includes(searchText)) ||
      (template.tags || []).some(t => String(t).toLowerCase().includes(searchText))
    );
    return matchesTag && matchesScope && matchesText;
  });

  return (
    <Dialog
      isOpen={true}
      onClose={handleCancel}
      title="Criar Novo Fluxo"
      size="xl"
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">
              Selecione um modelo para começar
            </p>
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="px-3 py-1.5 text-xs bg-bg-tertiary hover:bg-bg-hover text-text-secondary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              title="Atualizar lista de templates"
            >
              {refreshing ? (
                <>
                  <span className="animate-spin">⏳</span> Atualizando...
                </>
              ) : (
                <>
                  🔄 Atualizar
                </>
              )}
            </button>
          </div>
          
          {/* Campo de filtro */}
          <div className="relative">
            <Input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="🔍 Buscar templates por nome, descrição ou ID..."
              className="w-full"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors text-lg leading-none w-6 h-6 flex items-center justify-center"
                title="Limpar filtro"
              >
                ×
              </button>
            )}
          </div>

          {/* Filtro por escopo */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs text-text-tertiary">Escopo:</div>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-bg-tertiary border border-border-default rounded-md text-text-secondary"
              aria-label="Filtrar templates por escopo"
            >
              <option value="all">Todos</option>
              <option value="global">Catálogo (global)</option>
              <option value="tenant">Meus templates</option>
            </select>
          </div>

          {/* Filtro por tags */}
          {availableTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTagFilter('')}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${tagFilter ? 'bg-bg-tertiary border-border-default text-text-secondary hover:bg-bg-hover' : 'bg-accent-primary/10 border-accent-primary text-accent-primary'}`}
                title="Mostrar todas"
              >
                Todas
              </button>
              {availableTags.slice(0, 20).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${tagFilter === tag ? 'bg-accent-primary/10 border-accent-primary text-accent-primary' : 'bg-bg-tertiary border-border-default text-text-secondary hover:bg-bg-hover'}`}
                  title={`Filtrar por ${tag}`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          
          {filterText && (
            <div className="text-xs text-text-tertiary">
              {filteredTemplates.length === 0 
                ? 'Nenhum template encontrado' 
                : `${filteredTemplates.length} template(s) encontrado(s)`}
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
            {error}
          </div>
        )}

        {templates.length === 0 ? (
          <div className="text-center p-8 text-text-secondary">
            Nenhum template disponível.
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center p-8 text-text-secondary">
            Nenhum template encontrado com "{filterText}".
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="relative p-4 rounded-md border border-border-default bg-bg-tertiary cursor-pointer transition-all duration-fast hover:border-border-hover hover:bg-bg-hover hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent-light group"
              >
                <div
                  onClick={() => handleSelectTemplate(template)}
                  className="w-full"
                >
                  <div className="text-3xl mb-2 text-center">{template.icon}</div>
                    <div className="text-[10px] text-text-tertiary text-center mb-1">
                      {(template.tenantId && template.tenantId !== 'system') ? 'MEU TEMPLATE' : 'GLOBAL'}
                    </div>
                  <div className="text-sm font-semibold text-text-primary mb-1 text-center">
                    {template.name}
                  </div>
                  <div className="text-[11px] text-text-tertiary text-center leading-snug">
                    {template.description}
                  </div>
                  {Array.isArray(template.tags) && template.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-center mt-2">
                      {template.tags.slice(0, 4).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTagFilter(tagFilter === t ? '' : t);
                            }}
                            className="px-2 py-0.5 text-[10px] rounded-full bg-bg-secondary border border-border-default text-text-tertiary hover:bg-bg-hover transition-colors"
                            title={`Filtrar por ${t}`}
                          >
                          {t}
                          </button>
                      ))}
                    </div>
                  )}
                </div>
                {(template.tenantId && template.tenantId !== 'system') && (
                  <button
                    onClick={(e) => handleDeleteClick(e, template)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-status-error/10 hover:bg-status-error/20 text-status-error opacity-0 group-hover:opacity-100 transition-opacity duration-fast flex items-center justify-center text-xs font-bold"
                    title="Remover template"
                    disabled={deleting}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <ConfirmDialog
          isOpen={!!templateToDelete}
          onClose={() => setTemplateToDelete(null)}
          onConfirm={handleConfirmDelete}
          title="Remover Template"
          message={`Tem certeza que deseja remover o template "${templateToDelete?.name}"?\n\nEsta ação não pode ser desfeita.`}
          confirmText="Remover"
          cancelText="Cancelar"
          variant="danger"
          icon="🗑️"
        />

        <div className="flex justify-end pt-4">
          <Button variant="ghost" onClick={handleCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

