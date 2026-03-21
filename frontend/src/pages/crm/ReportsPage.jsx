import React from 'react';
import { CrmCard, CrmButton } from '../../components/crm/CrmComponents';
import { CrudPageBase } from '../../modules/crud-base';

export function ReportsPage() {
  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>📈 Relatórios CRM</h1>
        <p>Insights de vendas e previsões de receita.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <CrmCard>
          <h3 className="text-lg font-semibold mb-4">📊 Vendas por Período</h3>
          <p className="text-sm text-text-secondary mb-4">
            Análise de vendas fechadas, receita e número de deals por mês/trimestre.
          </p>
          <CrmButton style={{ width: '100%' }}>Gerar Relatório</CrmButton>
        </CrmCard>

        <CrmCard>
          <h3 className="text-lg font-semibold mb-4">📈 Performance de Pipeline</h3>
          <p className="text-sm text-text-secondary mb-4">
            Tempo médio por estágio, taxa de conversão e gargalos identificados.
          </p>
          <CrmButton style={{ width: '100%' }}>Gerar Relatório</CrmButton>
        </CrmCard>

        <CrmCard>
          <h3 className="text-lg font-semibold mb-4">🎯 Conversão de Leads</h3>
          <p className="text-sm text-text-secondary mb-4">
            Funil completo de qualificação, fontes mais eficientes e ROI.
          </p>
          <CrmButton style={{ width: '100%' }}>Gerar Relatório</CrmButton>
        </CrmCard>
      </div>

      <CrmCard>
        <h2 className="text-2xl font-bold mb-4">📅 Previsão de Receita</h2>
        <div className="bg-bg-hover rounded-lg p-6 border border-border-default">
          <p className="text-text-secondary">Previsão baseada em probabilidade de fechamento e histórico.</p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-text-secondary">Este Mês</div>
              <div className="text-2xl font-bold text-status-success">R$ 450k</div>
            </div>
            <div>
              <div className="text-sm text-text-secondary">Próximo Trimestre</div>
              <div className="text-2xl font-bold text-accent-primary">R$ 1.2M</div>
            </div>
            <div>
              <div className="text-sm text-text-secondary">Ano Fiscal</div>
              <div className="text-2xl font-bold text-text-primary">R$ 5.8M</div>
            </div>
          </div>
        </div>
      </CrmCard>
    </CrudPageBase>
  );
}
