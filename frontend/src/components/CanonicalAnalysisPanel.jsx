import React, { useState } from 'react';

/**
 * Renderiza análise canônica do processo: validação, sugestões de otimização e gap analysis.
 * Exibe resultados em abas para organizar informações.
 */
export function CanonicalAnalysisPanel({ canonical, currentFlow }) {
  const [activeTab, setActiveTab] = useState('validation');

  if (!canonical) {
    return null;
  }

  const {
    validationReport = {},
    compilationReport = {},
  } = canonical;

  const isValid = validationReport.valid === true;
  const errors = validationReport.errors || [];
  const warnings = validationReport.warnings || [];
  const suggestions = validationReport.suggestions || [];

  return (
    <div className="canonical-analysis-panel border rounded bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200">
            📋 Análise Canônica
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                isValid
                  ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                  : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
              }`}
            >
              {isValid ? '✓ Válido' : '✗ Inválido'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button
          onClick={() => setActiveTab('validation')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'validation'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
          }`}
        >
          Validação
          {errors.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs bg-red-500 text-white rounded-full">
              {errors.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('suggestions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'suggestions'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
          }`}
        >
          Sugestões
          {suggestions.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs bg-blue-500 text-white rounded-full">
              {suggestions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('gap')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'gap'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
          }`}
        >
          Gap Analysis
        </button>
      </div>

      {/* Content */}
      <div className="p-4 max-h-96 overflow-y-auto">
        {activeTab === 'validation' && (
          <ValidationTab errors={errors} warnings={warnings} />
        )}
        {activeTab === 'suggestions' && (
          <SuggestionsTab suggestions={suggestions} warnings={warnings} />
        )}
        {activeTab === 'gap' && (
          <GapAnalysisTab
            processDefinition={canonical.compiledProcessDefinition}
            nodes={currentFlow?.nodes}
          />
        )}
      </div>

      {/* Summary Footer */}
      <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex gap-4">
          <span>{errors.length} erro(s)</span>
          <span>{warnings.length} alerta(s)</span>
          <span>{suggestions.length} sugestão(ões)</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Exibe erros e warnings da validação canônica
 */
function ValidationTab({ errors, warnings }) {
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500 dark:text-gray-400">
        <p>✓ Nenhum erro ou alerta encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Erros */}
      {errors.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-2 text-red-700 dark:text-red-300">
            🔴 Erros ({errors.length})
          </h4>
          <ul className="space-y-2">
            {errors.map((err, idx) => (
              <li key={`error-${idx}`} className="text-xs p-2 bg-red-50 dark:bg-red-900 rounded border border-red-200 dark:border-red-700">
                <div className="font-mono text-red-700 dark:text-red-300 mb-1">
                  [{err.code}]
                </div>
                <div className="text-gray-700 dark:text-gray-300">
                  {err.message}
                </div>
                {err.nodeIds && err.nodeIds.length > 0 && (
                  <div className="mt-1 text-gray-600 dark:text-gray-400">
                    Nós: {err.nodeIds.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Alertas */}
      {warnings.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-2 text-yellow-700 dark:text-yellow-300">
            ⚠️ Alertas ({warnings.length})
          </h4>
          <ul className="space-y-2">
            {warnings.map((warn, idx) => (
              <li key={`warn-${idx}`} className="text-xs p-2 bg-yellow-50 dark:bg-yellow-900 rounded border border-yellow-200 dark:border-yellow-700">
                <div className="font-mono text-yellow-700 dark:text-yellow-300 mb-1">
                  [{warn.code}]
                </div>
                <div className="text-gray-700 dark:text-gray-300">
                  {warn.message}
                </div>
                {warn.nodeIds && warn.nodeIds.length > 0 && (
                  <div className="mt-1 text-gray-600 dark:text-gray-400">
                    Nós: {warn.nodeIds.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Exibe sugestões de otimização
 */
function SuggestionsTab({ suggestions, warnings }) {
  const allSuggestions = [...(suggestions || []), ...(warnings || [])];

  if (allSuggestions.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500 dark:text-gray-400">
        <p>✓ Nenhuma sugestão de otimização</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {allSuggestions.map((sug, idx) => (
        <li key={`sug-${idx}`} className="text-xs p-2 bg-blue-50 dark:bg-blue-900 rounded border border-blue-200 dark:border-blue-700">
          <div className="font-mono text-blue-700 dark:text-blue-300 mb-1">
            💡 {sug.code}
          </div>
          <div className="text-gray-700 dark:text-gray-300">
            {sug.message}
          </div>
          {sug.details && (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 p-1 rounded">
              {JSON.stringify(sug.details).substring(0, 100)}...
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Exibe análise de gap (readiness assessment)
 */
function GapAnalysisTab({ processDefinition, nodes }) {
  const nodeCount = nodes?.length || 0;
  const hasStart = nodes?.some((n) => n.type === 'start') ?? false;
  const hasEnd = nodes?.some((n) => n.type === 'end') ?? false;
  const hasGateway = nodes?.some((n) => n.type === 'router' || n.type === 'schedule_router') ?? false;
  const hasService = nodes?.some((n) => n.type === 'api' || n.type === 'subflow') ?? false;

  const requirements = [
    { name: 'Nó de Início (start)', met: hasStart },
    { name: 'Nó de Fim (end)', met: hasEnd },
    { name: 'Nó de Decisão (gateway)', met: hasGateway, required: false },
    { name: 'Integração de Serviço (api/subflow)', met: hasService, required: false },
  ];

  const metRequired = requirements.filter((r) => r.required !== false).every((r) => r.met);
  const readiness = metRequired ? 'pronto' : 'parcial';

  return (
    <div className="space-y-4">
      {/* Readiness Badge */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-semibold">Status de Execução:</span>
        <span
          className={`px-3 py-1 rounded text-xs font-medium ${
            readiness === 'pronto'
              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
              : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
          }`}
        >
          {readiness === 'pronto' ? '✓ Pronto para Execução' : '⚠️ Execução Parcial'}
        </span>
      </div>

      {/* Checklist */}
      <div>
        <h4 className="font-semibold text-sm mb-2 text-gray-800 dark:text-gray-200">
          Requisitos de Operação
        </h4>
        <ul className="space-y-2">
          {requirements.map((req, idx) => (
            <li key={`req-${idx}`} className="flex items-center gap-2 text-xs">
              <span className={req.met ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                {req.met ? '✓' : '○'}
              </span>
              <span className={req.met ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'}>
                {req.name}
                {req.required === false && <span className="text-gray-400"> (opcional)</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Process Stats */}
      <div className="bg-gray-100 dark:bg-gray-800 rounded p-3 text-xs space-y-1">
        <div className="text-gray-600 dark:text-gray-400">
          <span className="font-semibold">Total de Nós:</span> {nodeCount}
        </div>
        {nodeCount > 0 && (
          <>
            <div className="text-gray-600 dark:text-gray-400">
              <span className="font-semibold">Tipo Predominante:</span>{' '}
              {hasService ? 'Serviços/Integrações' : hasGateway ? 'Lógica de Decisão' : 'Mensagens'}
            </div>
            <div className="text-gray-600 dark:text-gray-400">
              <span className="font-semibold">Complexidade:</span>{' '}
              {nodeCount <= 3 ? 'Simples' : nodeCount <= 10 ? 'Moderada' : 'Complexa'}
            </div>
          </>
        )}
      </div>

      {/* Recommendations */}
      {!metRequired && (
        <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded p-3 text-xs">
          <p className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
            ⚠️ Recomendações
          </p>
          <ul className="list-disc list-inside space-y-1 text-yellow-700 dark:text-yellow-300">
            {!hasStart && <li>Adicione um nó de início (start)</li>}
            {!hasEnd && <li>Adicione um nó de fim (end)</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CanonicalAnalysisPanel;
