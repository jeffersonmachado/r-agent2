import React from 'react';

/**
 * @param {{isTenantMode: boolean, onReload: Function}} props
 * @returns {JSX.Element}
 */
export function GenerateSystemHeader({ isTenantMode, onReload }) {
  return (
    <div className="support-header">
      <div className="page-header">
        <h1>{isTenantMode ? '🤖 Criar Tenant por IA' : '🎯 Gerar Sistema / Fluxo / RPA / Seed'}</h1>
      </div>
      <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
        {isTenantMode
          ? 'Crie um tenant baseado em uma empresa real. Configure todos os blocos conforme necessário para gerar o tenant e seus artefatos (fluxo, RPA, seed).'
          : 'Esta é a única tela que gera, valida, executa e decide. Nada fora dessa tela é considerado válido.'}
      </p>
      {isTenantMode && (
        <div className="bg-status-info/10 border border-status-info/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-text-primary">
            <strong>💡 Modo de Geração de Tenant:</strong>
          </p>
          <ul className="mt-2 text-xs text-text-secondary list-disc list-inside space-y-1">
            <li>Preencha o nome e a descrição do tenant (empresa real)</li>
            <li>Configure as fontes de conhecimento (RAG e/ou Web Scraping) para obter informações da empresa</li>
            <li>Selecione quais artefatos deseja gerar (Fluxo, RPA, Seed)</li>
            <li>A IA irá gerar os dados do tenant e, se solicitado, os artefatos configurados</li>
            <li>O tenant será criado automaticamente após a geração</li>
          </ul>
        </div>
      )}

      <div className="support-controls">
        <button
          type="button"
          className="btn-default px-4 py-2 text-sm"
          onClick={onReload}
        >
          🔄 Atualizar
        </button>
      </div>
    </div>
  );
}
