import React from 'react';
import { Button } from '../../styles/Button';
import { Input, Textarea } from '../../styles/Input';
import { AutoInitialGraphCanvas } from '../../components/AutoInitialGraphCanvas';

/**
 * @param {Record<string, unknown>} props
 * @returns {JSX.Element}
 */
export function GenerateSystemFormSection({
  // BLOCO 1
  bootstrap,
  setBootstrap,
  generateFlow,
  setGenerateFlow,
  generateRpa,
  setGenerateRpa,
  generateSeed,
  setGenerateSeed,
  includeQuestions,
  setIncludeQuestions,
  executeFullValidation,
  setExecuteFullValidation,
  // Dados Básicos
  name,
  setName,
  description,
  setDescription,
  descriptionMode,
  setDescriptionMode,
  isTenantMode,
  executionMode,
  // Fluxo inicial
  initialGraphLoading,
  initialFlow,
  pipelineExecutionIdRef,
  validatedTenantId,
  agent,
  downloadJsonFile,
  setShowInitialFlowModal,
  // BLOCO 4
  setExecutionMode,
  rpaMode,
  setRpaMode,
}) {
  return (
    <>
        {/* BLOCO 1 - Intenção do Usuário */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
            <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 1 — Intenção do Usuário</h2>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={bootstrap}
                  onChange={(e) => setBootstrap(e.target.checked)}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span className="font-bold">Gerar tudo do zero (Bootstrap)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={generateFlow}
                  onChange={(e) => setGenerateFlow(e.target.checked)}
                  disabled={bootstrap}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Gerar Fluxo</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={generateRpa}
                  onChange={(e) => setGenerateRpa(e.target.checked)}
                  disabled={bootstrap}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Gerar Teste RPA</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={generateSeed}
                  onChange={(e) => setGenerateSeed(e.target.checked)}
                  disabled={bootstrap}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Gerar Seed</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={bootstrap ? true : includeQuestions}
                  onChange={(e) => setIncludeQuestions(e.target.checked)}
                  disabled={bootstrap}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Incluir perguntas (FAQ) no fluxo</span>
              </label>
            <label className="flex items-center gap-2 cursor-pointer text-text-primary">
              <input
                type="checkbox"
                checked={executeFullValidation}
                onChange={(e) => setExecuteFullValidation(e.target.checked)}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span>Executar Validação Completa</span>
            </label>
            </div>
          {bootstrap && (
            <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg text-status-warning">
              ⚠️ Modo Bootstrap ativo: Fluxo, RPA e Seed serão gerados automaticamente. RAG desativado. FAQ habilitado automaticamente.
            </div>
          )}
        </div>

        {/* Dados Básicos */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            {isTenantMode ? 'Descrição do Tenant' : 'Dados Básicos'}
          </h2>
          <div className="mb-4">
            <label className="block mb-2 font-semibold text-text-primary">
              {isTenantMode ? 'Nome do Tenant' : 'Nome do Sistema/Fluxo'}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isTenantMode ? "Ex: Empresa XYZ" : "Ex: Sistema de Atendimento"}
              className="w-full"
            />
          </div>
          <div>
            <label className="block mb-2 font-semibold text-text-primary">
              {isTenantMode 
                ? (executionMode === 'real' ? 'Descrição do Tenant *' : 'Descrição do Tenant (opcional no modo dry-run)')
                : executionMode === 'real' 
                  ? 'Descrição *' 
                  : 'Descrição (opcional no modo dry-run)'}
            </label>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm text-text-secondary">Modo da sugestão:</span>
              <select
                value={descriptionMode}
                onChange={(e) => setDescriptionMode(e.target.value)}
                className="px-3 py-2 rounded-lg bg-bg-secondary border border-border-default text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              >
                <option value="institutional">Institucional (padrão)</option>
                <option value="technical">Técnico (auditoria)</option>
              </select>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isTenantMode 
                ? "Ex: Uma empresa de e-commerce que vende produtos de tecnologia e quer automatizar o atendimento ao cliente para reduzir tempo de resposta e aumentar a satisfação dos clientes."
                : executionMode === 'dry-run' && !description.trim()
                  ? "💡 No modo dry-run, a descrição é opcional. Se deixar em branco, a IA irá sugerir uma descrição baseada no nome e nas fontes de conhecimento selecionadas. Descreva o sistema, fluxo ou funcionalidade que deseja gerar..."
                  : "Descreva o sistema, fluxo ou funcionalidade que deseja gerar..."}
              rows={5}
              className="w-full"
            />
            {isTenantMode && (
              <p className="mt-2 text-xs text-text-secondary">
                💡 Seja específico! Inclua informações sobre o ramo de atividade, tipo de negócio e objetivos.
              </p>
            )}
            {executionMode === 'dry-run' && !description.trim() && (
              <p className="mt-2 text-xs text-status-info bg-status-info/10 border border-status-info/30 rounded-lg p-2">
                💡 <strong>Modo Dry-Run:</strong> A descrição é opcional. Se deixar em branco, a IA irá sugerir uma descrição automaticamente baseada no {isTenantMode ? 'nome do tenant' : 'nome do sistema'} e nas fontes de conhecimento selecionadas.
              </p>
            )}
            {executionMode === 'real' && (
              <p className="mt-2 text-xs text-text-secondary">
                ⚠️ <strong>Modo Execução Real:</strong> A descrição é obrigatória e deve ter pelo menos 10 caracteres.
              </p>
            )}
          </div>
        </div>


        {/* Fluxo inicial (auto) - Canvas Rete */}
        {(initialGraphLoading || initialFlow) && (
          isTenantMode ? (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-xl font-semibold text-text-primary">Fluxo inicial (auto)</h2>
                <div className="flex items-center gap-2">
                  {initialGraphLoading && (
                    <span className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1">
                      Gerando...
                    </span>
                  )}
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => {
                      if (!initialFlow) return;
                      const execId = pipelineExecutionIdRef.current || 'sem-execucao';
                      const tenantId = validatedTenantId || agent?.tenantId || 'tenant';
                      downloadJsonFile(initialFlow, `initial-flow-${tenantId}-${execId}`);
                    }}
                    disabled={!initialFlow}
                    title={!initialFlow ? 'Aguardando fluxo inicial...' : 'Baixar JSON do fluxo inicial'}
                  >
                    Exportar JSON
                  </Button>
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => setShowInitialFlowModal(true)}
                    disabled={!initialFlow}
                    title={!initialFlow ? 'Aguardando fluxo inicial...' : 'Abrir fluxo em modal'}
                  >
                    Abrir em modal
                  </Button>
                </div>
              </div>

              <p className="text-sm text-text-secondary">
                No modo tenant, o fluxo é exibido em um <strong>modal redimensionável</strong> para não ocupar a tela inteira.
              </p>

              {!initialFlow && initialGraphLoading && (
                <div className="mt-3 text-sm text-text-secondary">
                  Gerando grafo visual automaticamente a partir do FAQ...
                </div>
              )}
            </div>
          ) : (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-xl font-semibold text-text-primary">
                  Fluxo inicial (auto)
                </h2>
                <div className="flex items-center gap-2">
                  {initialGraphLoading && (
                    <span className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1">
                      Gerando...
                    </span>
                  )}
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => {
                      if (!initialFlow) return;
                      const execId = pipelineExecutionIdRef.current || 'sem-execucao';
                      const tenantId = validatedTenantId || agent?.tenantId || 'tenant';
                      downloadJsonFile(initialFlow, `initial-flow-${tenantId}-${execId}`);
                    }}
                    disabled={!initialFlow}
                    title={!initialFlow ? 'Aguardando fluxo inicial...' : 'Baixar JSON do fluxo inicial'}
                  >
                    Exportar JSON
                  </Button>
                </div>
              </div>
              {initialFlow && (
                <AutoInitialGraphCanvas flow={initialFlow} />
              )}
              {!initialFlow && initialGraphLoading && (
                <div className="text-sm text-text-secondary">
                  Gerando grafo visual automaticamente a partir do FAQ...
                </div>
              )}
            </div>
          )
        )}

        {/* BLOCO 4 - Configuração da Execução */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 4 — Configuração da Execução</h2>
          <div className="mb-4">
            <label className="block mb-2 font-semibold text-text-primary">
              Modo de execução:
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="radio"
                  name="executionMode"
                  value="dry-run"
                  checked={executionMode === 'dry-run'}
                  onChange={(e) => setExecutionMode(e.target.value)}
                  className="w-4 h-4 text-accent-primary border-border-default focus:ring-accent-primary"
                />
                <span>DRY-RUN (padrão)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="radio"
                  name="executionMode"
                  value="real"
                  checked={executionMode === 'real'}
                  onChange={(e) => setExecutionMode(e.target.value)}
                  className="w-4 h-4 text-accent-primary border-border-default focus:ring-accent-primary"
                />
                <span>Execução real</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block mb-2 font-semibold text-text-primary">
              Modo de geração de RPA:
            </label>
            <select
              value={rpaMode}
              onChange={(e) => setRpaMode(e.target.value)}
              className="px-3 py-2 rounded-lg bg-bg-secondary border border-border-default text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="infer">infer</option>
              <option value="record">record</option>
              <option value="hybrid">hybrid</option>
            </select>
          </div>
        </div>
    </>
  );
}
