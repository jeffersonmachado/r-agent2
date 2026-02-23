import React from 'react';
import { CrmCard } from '../../components/crm/CrmComponents';

export function ReportsPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Relatórios CRM</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <CrmCard>
          <h3 className="text-lg font-semibold mb-4">📊 Vendas por Período</h3>
          <p className="text-sm text-gray-600 mb-4">
            Análise de vendas fechadas, receita e número de deals por mês/trimestre.
          </p>
          <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Gerar Relatório
          </button>
        </CrmCard>

        <CrmCard>
          <h3 className="text-lg font-semibold mb-4">📈 Performance de Pipeline</h3>
          <p className="text-sm text-gray-600 mb-4">
            Tempo médio por estágio, taxa de conversão e gargalos identificados.
          </p>
          <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Gerar Relatório
          </button>
        </CrmCard>

        <CrmCard>
          <h3 className="text-lg font-semibold mb-4">🎯 Conversão de Leads</h3>
          <p className="text-sm text-gray-600 mb-4">
            Funil completo de qualificação, fontes mais eficientes e ROI.
          </p>
          <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Gerar Relatório
          </button>
        </CrmCard>
      </div>

      <CrmCard>
        <h2 className="text-2xl font-bold mb-4">📅 Previsão de Receita</h2>
        <div className="bg-gray-50 rounded-lg p-6">
          <p className="text-gray-600">Previsão baseada em probabilidade de fechamento e histórico.</p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-gray-600">Este Mês</div>
              <div className="text-2xl font-bold text-green-600">R$ 450k</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Próximo Trimestre</div>
              <div className="text-2xl font-bold text-blue-600">R$ 1.2M</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Ano Fiscal</div>
              <div className="text-2xl font-bold text-purple-600">R$ 5.8M</div>
            </div>
          </div>
        </div>
      </CrmCard>
    </div>
  );
}
