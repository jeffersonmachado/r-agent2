import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { getTenantSetting, upsertTenantSetting } from '../api/tenantSettings';

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
      showToast('Erro ao carregar settings', 'error');
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
        showToast('JSON inválido', 'error');
        return;
      }
      const out = await upsertTenantSetting(key, value);
      if (!out?.ok) {
        showToast('Falha ao salvar setting', 'error');
        return;
      }
      showToast('Setting salvo com sucesso', 'success');
    } catch (err) {
      logger.error('Erro ao salvar setting:', err);
      showToast('Erro ao salvar setting', 'error');
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
        <h1 style={{ fontSize: '22px', marginBottom: '12px' }}>SSO / SCIM</h1>
        <p style={{ color: '#6b7280', marginBottom: '20px' }}>
          Configurações básicas para identidade e provisionamento.
        </p>

        <div style={{ display: 'grid', gap: '16px' }}>
          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>SSO</h2>
            <textarea rows={10} value={ssoJson} onChange={(e) => setSsoJson(e.target.value)} style={{ width: '100%' }} />
            <div style={{ marginTop: '8px' }}>
              <button onClick={() => handleSave('sso')} disabled={loading}>Salvar SSO</button>
            </div>
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>SCIM</h2>
            <textarea rows={10} value={scimJson} onChange={(e) => setScimJson(e.target.value)} style={{ width: '100%' }} />
            <div style={{ marginTop: '8px' }}>
              <button onClick={() => handleSave('scim')} disabled={loading}>Salvar SCIM</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
