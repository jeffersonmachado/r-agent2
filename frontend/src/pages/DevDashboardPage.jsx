import React from 'react';
import { LogViewer } from '../components/LogViewer';
import { useTheme } from '../styles/themeContext';
import { useDevDashboard } from '../hooks/useDevDashboard';
import { useIsMobile } from '../hooks/useIsMobile';
import { DevDashboardHeader } from '../components/DevDashboard/DevDashboardHeader';
import { DevDashboardTabs } from '../components/DevDashboard/DevDashboardTabs';
import { FeaturesTab } from '../components/DevDashboard/FeaturesTab';
import { StatusTab } from '../components/DevDashboard/StatusTab';
import { FileEditor } from '../components/DevDashboard/FileEditor';
import { 
  formatTime, 
  formatNumber, 
  getFileInfo, 
  getPromptInfo, 
  getNodeFileInfo, 
  getCategoryIcon 
} from '../utils/devDashboardUtils';

/**
 * Dashboard de Desenvolvimento - Versão Refatorada
 * 
 * Funcionalidades:
 * - Status dos serviços em tempo real
 * - Logs do sistema
 * - Métricas de performance
 * - Informações do ambiente
 * - Ferramentas de desenvolvimento
 * - Status de rate limiting
 * - Conexões WebSocket
 * - Gerenciamento de arquivos (contratos, documentos, nós)
 */
export function DevDashboardPage() {
  const { theme } = useTheme();
  const dashboard = useDevDashboard();
  const isMobile = useIsMobile();

  const {
    activeTab,
    setActiveTab,
    systemStatus,
    metrics,
    envInfo,
    rateLimitStatus,
    wsConnections,
    loading,
    autoRefresh,
    setAutoRefresh,
    refreshInterval,
    setRefreshInterval,
    showLogs,
    setShowLogs,
    lastUpdate,
    devFiles,
    expandedCategories,
    setExpandedCategories,
    selectedFile,
    fileContent,
    setFileContent,
    fileLoading,
    fileSaving,
    fileError,
    jsonData,
    refreshAll,
    fetchDevFiles,
    loadFileContent,
    saveFile,
    updateJsonFromForm,
    updateJsonDataFromPath,
    clearRateLimitCache,
  } = dashboard;

  // Handler para atualizar JSON
  const handleUpdateJson = (newData, currentPath = '') => {
    if (!currentPath) {
      updateJsonFromForm(newData);
    } else {
      updateJsonDataFromPath(currentPath, newData);
    }
  };

  return (
    <>
      <style>{`
        .dev-dashboard-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .dev-dashboard-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .dev-dashboard-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3);
          border-radius: 4px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .dev-dashboard-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.5);
        }
        .dev-dashboard-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div className="h-screen w-full flex flex-col overflow-hidden" style={{ backgroundColor: theme.colors.bg.primary }}>
        <div className="flex-1 overflow-y-auto dev-dashboard-scroll">
          <div className="p-4 md:p-6 lg:p-8">
            <div className="w-full">
              <DevDashboardHeader
                onShowLogs={() => setShowLogs(true)}
                onRefresh={refreshAll}
                loading={loading}
                autoRefresh={autoRefresh}
                setAutoRefresh={setAutoRefresh}
                refreshInterval={refreshInterval}
                setRefreshInterval={setRefreshInterval}
                lastUpdate={lastUpdate}
              />

              <DevDashboardTabs activeTab={activeTab} setActiveTab={setActiveTab} />

              {/* Conteúdo das tabs */}
              <div className="rounded-lg p-4 md:p-6" style={{ 
                backgroundColor: theme.colors.bg.elevated,
                border: `1px solid ${theme.colors.border.default}`,
                boxShadow: theme.name === 'dark' ? '0 4px 6px rgba(0, 0, 0, 0.3)' : '0 4px 6px rgba(0, 0, 0, 0.1)'
              }}>
                {/* Tab: Funcionalidades */}
                {activeTab === 'features' && <FeaturesTab />}

                {/* Tab: Status */}
                {activeTab === 'status' && <StatusTab systemStatus={systemStatus} />}

                {/* Tab: Métricas - Mantida inline por enquanto */}
                {activeTab === 'metrics' && (
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Métricas de Performance</h2>
                    {metrics ? (
                      <div className="space-y-6">
                        {metrics.general && (
                          <div>
                            <h3 className="text-xl font-semibold mb-4" style={{ color: theme.colors.text.primary }}>
                              📊 Visão Geral
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Total de Tickets</div>
                                <div className="text-3xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatNumber(metrics.general.totalTickets || 0)}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tickets Abertos</div>
                                <div className="text-3xl font-bold" style={{ color: theme.colors.status.warning }}>
                                  {formatNumber(metrics.general.openTickets || 0)}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tickets Fechados</div>
                                <div className="text-3xl font-bold" style={{ color: theme.colors.status.success }}>
                                  {formatNumber(metrics.general.closedTickets || 0)}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Em Andamento</div>
                                <div className="text-3xl font-bold" style={{ color: theme.colors.status.info }}>
                                  {formatNumber(metrics.general.inProgressTickets || 0)}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Aguardando</div>
                                <div className="text-3xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatNumber(metrics.general.waitingTickets || 0)}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Total de Mensagens</div>
                                <div className="text-3xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatNumber(metrics.general.totalMessages || 0)}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tempo Médio de Resolução</div>
                                <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatTime(metrics.general.avgResolutionTime)}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tempo Médio de Primeira Resposta</div>
                                <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatTime(metrics.general.avgFirstResponseTime)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {/* Outras seções de métricas podem ser adicionadas aqui */}
                        {metrics.timestamp && (
                          <div className="text-sm text-center" style={{ color: theme.colors.text.tertiary }}>
                            Última atualização: {new Date(metrics.timestamp).toLocaleString('pt-BR')}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                        Métricas não disponíveis. Verifique se o endpoint /analytics/metrics está disponível.
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Ambiente - Mantida inline por enquanto */}
                {activeTab === 'environment' && (
                  <div>
                    <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Informações do Ambiente</h2>
                    {envInfo ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                            <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Nome da Aplicação</div>
                            <div style={{ color: theme.colors.text.secondary }}>{envInfo.name || 'N/A'}</div>
                          </div>
                          <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                            <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Ambiente</div>
                            <div style={{ color: theme.colors.text.secondary }}>{envInfo.env || 'N/A'}</div>
                          </div>
                        </div>
                        {systemStatus?.services?.apiServer?.details && (
                          <div className="mt-4">
                            <h3 className="text-lg font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Detalhes da API</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                                <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Uptime</div>
                                <div style={{ color: theme.colors.text.secondary }}>
                                  {systemStatus.services.apiServer.details.uptimeFormatted || 'N/A'}
                                </div>
                              </div>
                              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                                <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Versão do Node</div>
                                <div style={{ color: theme.colors.text.secondary }}>
                                  {systemStatus.services.apiServer.details.nodeVersion || 'N/A'}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                        Carregando informações do ambiente...
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Rate Limit - Mantida inline por enquanto */}
                {activeTab === 'rate-limit' && (
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                      <h2 className="text-xl md:text-2xl font-bold" style={{ color: theme.colors.text.primary }}>Status de Rate Limiting</h2>
                      <button
                        onClick={clearRateLimitCache}
                        className="px-3 md:px-4 py-2 rounded-lg transition-colors text-sm md:text-base whitespace-nowrap"
                        style={{ 
                          backgroundColor: theme.colors.status.warning,
                          color: '#ffffff'
                        }}
                      >
                        🗑️ Limpar Cache
                      </button>
                    </div>
                    {rateLimitStatus ? (
                      <div className="space-y-4">
                        {Object.entries(rateLimitStatus).map(([operation, status]) => (
                          <div key={operation} className="p-4 rounded-lg" style={{ 
                            border: `1px solid ${theme.colors.border.default}`,
                            backgroundColor: theme.colors.bg.secondary
                          }}>
                            <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>{operation}</h3>
                            {status.error ? (
                              <div style={{ color: theme.colors.status.error }}>Erro: {status.error}</div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                                <div>
                                  <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Permitido</div>
                                  <div className="font-semibold" style={{ 
                                    color: status.allowed ? theme.colors.status.success : theme.colors.status.error
                                  }}>
                                    {status.allowed ? '✓ Sim' : '✗ Não'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Pontos Restantes</div>
                                  <div className="font-semibold" style={{ color: theme.colors.text.primary }}>
                                    {status.remainingPoints ?? 'N/A'} / {status.totalPoints ?? 'N/A'}
                                  </div>
                                </div>
                                {status.retryAfter && (
                                  <div>
                                    <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Retry After</div>
                                    <div className="font-semibold" style={{ color: theme.colors.text.primary }}>{status.retryAfter}s</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                        Carregando status de rate limit...
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: WebSocket - Mantida inline por enquanto */}
                {activeTab === 'websocket' && (
                  <div>
                    <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Conexões WebSocket</h2>
                    {wsConnections ? (
                      <div className="space-y-6">
                        <div className="p-4 rounded-lg" style={{ 
                          backgroundColor: theme.colors.bg.secondary,
                          border: `1px solid ${theme.colors.border.default}`
                        }}>
                          <h3 className="text-lg font-semibold mb-3" style={{ color: theme.colors.text.primary }}>Servidor</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                            <div>
                              <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Status</div>
                              <div className="font-semibold" style={{ 
                                color: wsConnections.server?.initialized ? '#10b981' : '#ef4444'
                              }}>
                                {wsConnections.server?.initialized ? '✓ Inicializado' : '✗ Não inicializado'}
                              </div>
                            </div>
                            <div>
                              <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Path</div>
                              <div className="font-semibold" style={{ color: theme.colors.text.primary }}>
                                {wsConnections.server?.path || 'N/A'}
                              </div>
                            </div>
                          </div>
                        </div>
                        {wsConnections.stats && (
                          <div className="p-4 rounded-lg" style={{ 
                            backgroundColor: theme.colors.bg.secondary,
                            border: `1px solid ${theme.colors.border.default}`
                          }}>
                            <h3 className="text-lg font-semibold mb-3" style={{ color: theme.colors.text.primary }}>Estatísticas</h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
                              <div>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Total de Clientes</div>
                                <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatNumber(wsConnections.stats.totalClients || 0)}
                                </div>
                              </div>
                              <div>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Autenticados</div>
                                <div className="text-2xl font-bold" style={{ color: '#10b981' }}>
                                  {formatNumber(wsConnections.stats.authenticatedClients || 0)}
                                </div>
                              </div>
                              <div>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Não Autenticados</div>
                                <div className="text-2xl font-bold" style={{ color: '#f59e0b' }}>
                                  {formatNumber(wsConnections.stats.unauthenticatedClients || 0)}
                                </div>
                              </div>
                              <div>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tenants Únicos</div>
                                <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatNumber(wsConnections.stats.uniqueTenants || 0)}
                                </div>
                              </div>
                              <div>
                                <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Agentes Únicos</div>
                                <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                                  {formatNumber(wsConnections.stats.uniqueAgents || 0)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                        Informações de WebSocket não disponíveis.
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Contratos - Usando FileEditor */}
                {activeTab === 'contracts-prompts' && (
                  <div>
                    <div className="mb-4 md:mb-6">
                      <h2 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: theme.colors.text.primary }}>
                        📋 Contratos
                      </h2>
                      <p className="text-sm md:text-base mb-4" style={{ color: theme.colors.text.secondary }}>
                        Gerencie os contratos de interface e estruturas de dados do sistema.
                      </p>
                      <button
                        onClick={fetchDevFiles}
                        className="px-3 md:px-4 py-2 rounded-lg transition-colors text-sm md:text-base"
                        style={{ 
                          backgroundColor: theme.colors.status.info,
                          color: '#ffffff'
                        }}
                      >
                        🔄 Atualizar Lista
                      </button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                      <div className="lg:col-span-1">
                            <div className="rounded-lg p-4 md:p-5" style={{ 
                          backgroundColor: theme.colors.bg.secondary,
                          border: `2px solid ${theme.colors.border.default}`,
                        }}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="text-2xl md:text-3xl">📋</div>
                            <div>
                              <h3 className="font-bold text-lg" style={{ color: theme.colors.text.primary }}>
                                Contratos
                              </h3>
                            </div>
                          </div>
                          <div className="space-y-3 max-h-[500px] md:max-h-[600px] overflow-y-auto">
                            {devFiles.contracts.length === 0 ? (
                              <div className="text-center py-4" style={{ color: theme.colors.text.tertiary }}>
                                <p className="text-sm">Nenhum contrato encontrado</p>
                              </div>
                            ) : (
                              devFiles.contracts.map((file) => {
                                const isSelected = selectedFile?.type === 'contracts' && selectedFile?.path === file.path;
                                const info = getFileInfo(file.name);
                                return (
                                  <button
                                    key={`contracts-${file.path}`}
                                    onClick={() => loadFileContent('contracts', file.path)}
                                    className="w-full text-left p-4 rounded-lg transition-all"
                                    style={{
                                      backgroundColor: isSelected ? info.color + '15' : theme.colors.bg.primary,
                                      border: `2px solid ${isSelected ? info.color : theme.colors.border.default}`,
                                    }}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className="text-2xl">{info.icon}</div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-sm mb-1" style={{ color: theme.colors.text.primary }}>
                                          {file.name}
                                        </div>
                                        <div className="text-xs mb-2" style={{ color: theme.colors.text.secondary }}>
                                          {info.desc}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs px-2 py-1 rounded" style={{ 
                                            backgroundColor: theme.colors.bg.tertiary,
                                            color: theme.colors.text.tertiary
                                          }}>
                                            {(file.size / 1024).toFixed(2)} KB
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="lg:col-span-2">
                        <FileEditor
                          selectedFile={selectedFile}
                          fileContent={fileContent}
                          setFileContent={setFileContent}
                          fileLoading={fileLoading}
                          fileSaving={fileSaving}
                          fileError={fileError}
                          jsonData={jsonData}
                          onSave={saveFile}
                          onUpdateJson={handleUpdateJson}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Documentos - Usando FileEditor */}
                {activeTab === 'documents' && (
                  <div>
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold mb-2" style={{ color: theme.colors.text.primary }}>
                        📚 Documentos
                      </h2>
                      <p className="text-base mb-4" style={{ color: theme.colors.text.secondary }}>
                        Gerencie os prompts de IA e documentação do sistema.
                      </p>
                      <button
                        onClick={fetchDevFiles}
                        className="px-3 md:px-4 py-2 rounded-lg transition-colors text-sm md:text-base"
                        style={{ 
                          backgroundColor: theme.colors.status.info,
                          color: '#ffffff'
                        }}
                      >
                        🔄 Atualizar Lista
                      </button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                      <div className="lg:col-span-1">
                        <div className="space-y-4 max-h-[600px] md:max-h-[800px] overflow-y-auto">
                          {devFiles.documents && Object.keys(devFiles.documents).length > 0 && (
                            <div className="rounded-lg p-4 md:p-5" style={{ 
                              backgroundColor: theme.colors.bg.secondary,
                              border: `2px solid ${theme.colors.border.default}`,
                            }}>
                              <div className="flex items-center gap-3 mb-4">
                                <div className="text-3xl">📚</div>
                                <div>
                                  <h3 className="font-bold text-lg" style={{ color: theme.colors.text.primary }}>
                                    Documentos Organizados
                                  </h3>
                                </div>
                              </div>
                              <div className="space-y-2">
                                {Object.entries(devFiles.documents).map(([category, files]) => {
                                  const categoryName = category.replace(/^\d{2}_/, '').replace(/_/g, ' ');
                                  // Em mobile, quando não está definido, considera como false (recolhido)
                                  const isExpanded = isMobile 
                                    ? expandedCategories[category] === true
                                    : expandedCategories[category] !== false;
                                  const icon = getCategoryIcon(categoryName);
                                  
                                  return (
                                    <div key={category} className="mb-3">
                                      <button
                                        onClick={() => setExpandedCategories(prev => ({
                                          ...prev,
                                          [category]: !isExpanded
                                        }))}
                                        className="w-full text-left p-3 rounded-lg transition-all flex items-center justify-between"
                                        style={{
                                          backgroundColor: theme.colors.bg.primary,
                                          border: `1px solid ${theme.colors.border.default}`,
                                        }}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-xl">{icon}</span>
                                          <div>
                                            <div className="font-semibold text-sm" style={{ color: theme.colors.text.primary }}>
                                              {categoryName}
                                            </div>
                                            <div className="text-xs" style={{ color: theme.colors.text.secondary }}>
                                              {files.length} arquivo{files.length !== 1 ? 's' : ''}
                                            </div>
                                          </div>
                                        </div>
                                        <span className="text-lg" style={{ color: theme.colors.text.secondary }}>
                                          {isExpanded ? '▼' : '▶'}
                                        </span>
                                      </button>
                                      {isExpanded && (
                                        <div className="mt-2 ml-4 space-y-2">
                                          {files.map((file) => {
                                            const isSelected = selectedFile?.type === 'documents' && 
                                              selectedFile?.path === `${category}/${file.path}`;
                                            return (
                                              <button
                                                key={`${category}-${file.path}`}
                                                onClick={() => loadFileContent('documents', `${category}/${file.path}`)}
                                                className="w-full text-left p-3 rounded-lg transition-all"
                                                style={{
                                                  backgroundColor: isSelected
                                                    ? theme.colors.status.info + '20'
                                                    : theme.colors.bg.primary,
                                                  border: `1px solid ${isSelected ? theme.colors.status.info : theme.colors.border.default}`,
                                                }}
                                              >
                                                <div className="flex items-start gap-2">
                                                  <span className="text-sm">📄</span>
                                                  <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-xs mb-1" style={{ color: theme.colors.text.primary }}>
                                                      {file.name}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-xs px-2 py-0.5 rounded" style={{ 
                                                        backgroundColor: theme.colors.bg.tertiary,
                                                        color: theme.colors.text.tertiary
                                                      }}>
                                                        {(file.size / 1024).toFixed(2)} KB
                                                      </span>
                                                    </div>
                                                  </div>
                                                </div>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="lg:col-span-2">
                        <FileEditor
                          selectedFile={selectedFile}
                          fileContent={fileContent}
                          setFileContent={setFileContent}
                          fileLoading={fileLoading}
                          fileSaving={fileSaving}
                          fileError={fileError}
                          jsonData={jsonData}
                          onSave={saveFile}
                          onUpdateJson={handleUpdateJson}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Nós - Usando FileEditor */}
                {activeTab === 'nodes' && (
                  <div>
                    <div className="mb-4 md:mb-6">
                      <h2 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: theme.colors.text.primary }}>
                        🔧 Nós dos Fluxos
                      </h2>
                      <p className="text-sm md:text-base mb-4" style={{ color: theme.colors.text.secondary }}>
                        Gerencie as definições de nós, schemas, regras e erros conhecidos dos fluxos.
                      </p>
                      <button
                        onClick={fetchDevFiles}
                        className="px-3 md:px-4 py-2 rounded-lg transition-colors text-sm md:text-base"
                        style={{ 
                          backgroundColor: theme.colors.status.info,
                          color: '#ffffff'
                        }}
                      >
                        🔄 Atualizar Lista
                      </button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                      <div className="lg:col-span-1">
                        <div className="rounded-lg p-4 md:p-5" style={{ 
                          backgroundColor: theme.colors.bg.secondary,
                          border: `2px solid ${theme.colors.border.default}`,
                        }}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="text-2xl md:text-3xl">🔧</div>
                            <div>
                              <h3 className="font-bold text-lg" style={{ color: theme.colors.text.primary }}>
                                Definições de Nós
                              </h3>
                            </div>
                          </div>
                          <div className="space-y-3 max-h-[600px] overflow-y-auto">
                            {devFiles.nodes.length === 0 ? (
                              <div className="text-center py-4" style={{ color: theme.colors.text.tertiary }}>
                                <p className="text-sm">Nenhum arquivo de nós encontrado</p>
                              </div>
                            ) : (
                              devFiles.nodes.map((file) => {
                                const isSelected = selectedFile?.type === 'nodes' && selectedFile?.path === file.path;
                                const info = getNodeFileInfo(file.name, file.path);
                                return (
                                  <button
                                    key={`nodes-${file.path}`}
                                    onClick={() => loadFileContent('nodes', file.path)}
                                    className="w-full text-left p-4 rounded-lg transition-all"
                                    style={{
                                      backgroundColor: isSelected ? info.color + '15' : theme.colors.bg.primary,
                                      border: `2px solid ${isSelected ? info.color : theme.colors.border.default}`,
                                    }}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className="text-2xl">{info.icon}</div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-sm mb-1" style={{ color: theme.colors.text.primary }}>
                                          {file.name}
                                        </div>
                                        <div className="text-xs mb-2" style={{ color: theme.colors.text.secondary }}>
                                          {info.desc}
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs px-2 py-1 rounded" style={{ 
                                            backgroundColor: theme.colors.bg.tertiary,
                                            color: theme.colors.text.tertiary
                                          }}>
                                            {(file.size / 1024).toFixed(2)} KB
                                          </span>
                                          <span className="text-xs px-2 py-1 rounded" style={{ 
                                            backgroundColor: info.color + '20',
                                            color: info.color
                                          }}>
                                            {info.category}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="lg:col-span-2">
                        <FileEditor
                          selectedFile={selectedFile}
                          fileContent={fileContent}
                          setFileContent={setFileContent}
                          fileLoading={fileLoading}
                          fileSaving={fileSaving}
                          fileError={fileError}
                          jsonData={jsonData}
                          onSave={saveFile}
                          onUpdateJson={handleUpdateJson}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Ferramentas - Mantida inline por enquanto */}
                {activeTab === 'tools' && (
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Ferramentas de Desenvolvimento</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg" style={{ 
                        border: `1px solid ${theme.colors.border.default}`,
                        backgroundColor: theme.colors.bg.secondary
                      }}>
                        <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>🔄 Limpar Cache de Rate Limit</h3>
                        <p className="text-sm mb-3" style={{ color: theme.colors.text.secondary }}>
                          Limpa o cache de rate limiting, útil para testes e desenvolvimento.
                        </p>
                        <button
                          onClick={clearRateLimitCache}
                          className="px-4 py-2 rounded-lg transition-colors"
                          style={{ 
                            backgroundColor: theme.colors.status.warning,
                            color: '#ffffff'
                          }}
                        >
                          Limpar Cache
                        </button>
                      </div>
                      <div className="p-4 rounded-lg" style={{ 
                        border: `1px solid ${theme.colors.border.default}`,
                        backgroundColor: theme.colors.bg.secondary
                      }}>
                        <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>📋 Visualizar Logs</h3>
                        <p className="text-sm mb-3" style={{ color: theme.colors.text.secondary }}>
                          Abre o visualizador de logs do sistema em tempo real.
                        </p>
                        <button
                          onClick={() => setShowLogs(true)}
                          className="px-3 md:px-4 py-2 rounded-lg transition-colors text-sm md:text-base"
                          style={{ 
                            backgroundColor: theme.colors.accent.primary,
                            color: '#ffffff'
                          }}
                        >
                          Abrir Logs
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal de Logs */}
        {showLogs && (
          <LogViewer onClose={() => setShowLogs(false)} />
        )}
      </div>
    </>
  );
}

