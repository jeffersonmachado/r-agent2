import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { exportTenantBackup, importTenantBackup } from '../api/backup';
import { Button } from '../styles/Button';
import { CrudPageBase, showCrudError, showCrudSuccess } from '../modules/crud-base';

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
        showCrudError(showToast, out, 'Falha ao exportar backup');
        return;
      }
      setExportData(out);
      showCrudSuccess(showToast, 'Backup exportado com sucesso');
    } catch (err) {
      logger.error('Erro ao exportar backup:', err);
      showCrudError(showToast, err, 'Erro ao exportar backup');
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
        showCrudError(showToast, out, 'Falha ao importar backup');
        return;
      }
      showCrudSuccess(showToast, `Importado: flows ${out.flowImported}, settings ${out.settingImported}`);
    } catch (err) {
      logger.error('Erro ao importar backup:', err);
      showCrudError(showToast, err, 'Erro ao importar backup (JSON invalido ou falha no servidor)');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <CrudPageBase title="🗄️ Backup / Recuperação">
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <CrudPageBase
      title="🗄️ Backup / Recuperação"
      actions={(
        <button
          type="button"
          className="btn-default px-4 py-2 text-sm"
          onClick={() => window.location.reload()}
        >
          🔄 Atualizar
        </button>
      )}
    >
      <ToastContainer />

      <div style={{ padding: '0 24px 24px 24px' }}>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
          Exportação e importação de flows e settings do tenant.
        </p>

        <div className="form-grid">
          <section className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-text-primary mb-3">Exportar</h2>
            <Button onClick={handleExport} disabled={loading}>Gerar backup</Button>
            {exportData ? (
              <textarea
                rows={10}
                value={JSON.stringify(exportData, null, 2)}
                readOnly
                className="w-full mt-3 p-3 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-sm"
              />
            ) : null}
          </section>

          <section className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-text-primary mb-3">Importar</h2>
            <textarea
              rows={10}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              className="w-full p-3 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-sm"
            />
            <div style={{ marginTop: '8px' }}>
              <Button onClick={handleImport} disabled={loading}>Importar backup</Button>
            </div>
          </section>
        </div>
      </div>
    </CrudPageBase>
  );
}
