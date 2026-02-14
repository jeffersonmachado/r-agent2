import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { exportTenantBackup, importTenantBackup } from '../api/backup';

export function BackupPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [exportData, setExportData] = useState(null);
  const [importJson, setImportJson] = useState('{\n  "overwrite": false,\n  "flows": [],\n  "settings": []\n}');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  async function handleExport() {
    setLoading(true);
    try {
      const out = await exportTenantBackup();
      if (!out?.ok) {
        showToast('Falha ao exportar backup', 'error');
        return;
      }
      setExportData(out);
      showToast('Backup exportado', 'success');
    } catch (err) {
      logger.error('Erro ao exportar backup:', err);
      showToast('Erro ao exportar backup', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setLoading(true);
    try {
      const payload = JSON.parse(importJson);
      const out = await importTenantBackup(payload);
      if (!out?.ok) {
        showToast('Falha ao importar backup', 'error');
        return;
      }
      showToast(`Importado: flows ${out.flowImported}, settings ${out.settingImported}`, 'success');
    } catch (err) {
      logger.error('Erro ao importar backup:', err);
      showToast('Erro ao importar backup (JSON inválido ou falha no servidor)', 'error');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="support-page">
      <ToastContainer />
      <div style={{ padding: '24px' }}>
        <h1 style={{ fontSize: '22px', marginBottom: '12px' }}>Backup / DR</h1>
        <p style={{ color: '#6b7280', marginBottom: '20px' }}>
          Exportação e importação de flows e settings do tenant.
        </p>

        <div style={{ display: 'grid', gap: '16px' }}>
          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Exportar</h2>
            <button onClick={handleExport} disabled={loading}>Gerar backup</button>
            {exportData ? (
              <textarea
                rows={10}
                value={JSON.stringify(exportData, null, 2)}
                readOnly
                style={{ width: '100%', marginTop: '12px' }}
              />
            ) : null}
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Importar</h2>
            <textarea
              rows={10}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: '8px' }}>
              <button onClick={handleImport} disabled={loading}>Importar backup</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
