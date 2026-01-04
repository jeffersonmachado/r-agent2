import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { fetchBlob } from '../api/client';
import logger from '../utils/logger';

export function ExportPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  
  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);
  
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: '',
  });
  const [exporting, setExporting] = useState(false);

  const handleExport = async (type) => {
    setExporting(true);
    try {
      const endpoints = {
        tickets: '/export/tickets.csv',
        metrics: '/export/metrics.csv',
        conversations: '/export/conversations.json',
        fullReport: '/export/full-report.json',
      };
      
      // Constrói query string com parâmetros de data
      const params = new URLSearchParams();
      if (dateRange.startDate) params.append('startDate', dateRange.startDate);
      if (dateRange.endDate) params.append('endDate', dateRange.endDate);
      
      const query = params.toString();
      const endpoint = `${endpoints[type]}${query ? `?${query}` : ''}`;
      
      // Usa client centralizado para garantir baseURL correta
      const response = await fetchBlob(endpoint, {
        method: 'GET',
      });
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `export_${type}_${new Date().toISOString().split('T')[0]}`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      } else {
        filename += type.includes('json') ? '.json' : '.csv';
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      showToast('Exportação iniciada!', 'success');
    } catch (error) {
      logger.error('Erro ao exportar:', error);
      showToast('Erro ao exportar dados', 'error');
    } finally {
      setExporting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📤 Exportação de Dados</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Exporte dados em diferentes formatos
        </p>
      </div>

        {/* Filtros de Data */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
            <span>🔍</span>
            <span>Período (opcional)</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Data Inicial
              </label>
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Data Final
              </label>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>

        {/* Opções de Exportação */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              Tickets (CSV)
            </h3>
            <p className="text-text-secondary mb-4">
              Exporta todos os tickets em formato CSV para Excel
            </p>
            <Button
              onClick={() => handleExport('tickets')}
              disabled={exporting}
              className="w-full"
            >
              {exporting ? 'Exportando...' : 'Exportar Tickets'}
            </Button>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-4xl mb-4">📈</div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              Métricas (CSV)
            </h3>
            <p className="text-text-secondary mb-4">
              Exporta métricas e KPIs em formato CSV
            </p>
            <Button
              onClick={() => handleExport('metrics')}
              disabled={exporting}
              className="w-full"
            >
              {exporting ? 'Exportando...' : 'Exportar Métricas'}
            </Button>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-4xl mb-4">💬</div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              Conversas (JSON)
            </h3>
            <p className="text-text-secondary mb-4">
              Exporta todas as conversas em formato JSON
            </p>
            <Button
              onClick={() => handleExport('conversations')}
              disabled={exporting}
              className="w-full"
            >
              {exporting ? 'Exportando...' : 'Exportar Conversas'}
            </Button>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-4xl mb-4">📋</div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              Relatório Completo (JSON)
            </h3>
            <p className="text-text-secondary mb-4">
              Exporta métricas + conversas em um único arquivo
            </p>
            <Button
              onClick={() => handleExport('fullReport')}
              disabled={exporting}
              className="w-full"
            >
              {exporting ? 'Exportando...' : 'Exportar Relatório'}
            </Button>
          </div>
        </div>
      <ToastContainer />
    </div>
  );
}
