import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { getTenantSetting, upsertTenantSetting } from '../api/tenantSettings';
import { Button } from '../styles/Button';
import { CrudPageBase, showCrudError, showCrudSuccess } from '../modules/crud-base';

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function SsoScimPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [ssoJson, setSsoJson] = useState('{\n  "enabled": false,\n  "provider": "oidc",\n  "issuer": "",\n  "clientId": "",\n  "clientSecret": "",\n  "redirectUri": ""\n}');
  const [scimJson, setScimJson] = useState('{\n  "enabled": false,\n  "token": "",\n  "baseUrl": ""\n}');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadSettings();
    }
  }, [authLoading, isAuthenticated]);

  async function loadSettings() {
    setLoading(true);
    try {
      const [sso, scim] = await Promise.all([
        getTenantSetting('sso'),
        getTenantSetting('scim'),
      ]);
      if (sso?.ok && sso.value) setSsoJson(JSON.stringify(sso.value, null, 2));
      if (scim?.ok && scim.value) setScimJson(JSON.stringify(scim.value, null, 2));
    } catch (err) {
      logger.error('Erro ao carregar settings:', err);
      showCrudError(showToast, err, 'Erro ao carregar settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(key) {
    setLoading(true);
    try {
      const raw = key === 'sso' ? ssoJson : scimJson;
      const value = safeJsonParse(raw, null);
      if (!value || typeof value !== 'object') {
        showCrudError(showToast, null, 'JSON invalido');
        return;
      }
      const out = await upsertTenantSetting(key, value);
      if (!out?.ok) {
        showCrudError(showToast, out, 'Falha ao salvar setting');
        return;
      }
      showCrudSuccess(showToast, 'Setting salvo com sucesso');
    } catch (err) {
      logger.error('Erro ao salvar setting:', err);
      showCrudError(showToast, err, 'Erro ao salvar setting');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <CrudPageBase title="SSO / SCIM">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <CrudPageBase
      title="SSO / SCIM"
      actions={(
        <Button onClick={loadSettings} disabled={loading}>
          🔄 Atualizar
        </Button>
      )}
    >
      <ToastContainer />
      <div style={{ padding: '24px' }}>
        <p style={{ color: '#6b7280', marginBottom: '20px' }}>
          Configurações básicas para identidade e provisionamento.
        </p>

        <div style={{ display: 'grid', gap: '16px' }}>
          <section className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-text-primary mb-3">SSO</h2>
            <textarea
              rows={10}
              value={ssoJson}
              onChange={(e) => setSsoJson(e.target.value)}
              className="w-full p-3 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-sm"
            />
            <div style={{ marginTop: '8px' }}>
              <Button onClick={() => handleSave('sso')} disabled={loading}>Salvar SSO</Button>
            </div>
          </section>

          <section className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-text-primary mb-3">SCIM</h2>
            <textarea
              rows={10}
              value={scimJson}
              onChange={(e) => setScimJson(e.target.value)}
              className="w-full p-3 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-sm"
            />
            <div style={{ marginTop: '8px' }}>
              <Button onClick={() => handleSave('scim')} disabled={loading}>Salvar SCIM</Button>
            </div>
          </section>
        </div>
      </div>
    </CrudPageBase>
  );
}
