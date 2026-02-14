import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { listSolutionPacks, installSolutionPack } from '../api/solutions';

export function SolutionsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [packs, setPacks] = useState([]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadPacks();
    }
  }, [authLoading, isAuthenticated]);

  async function loadPacks() {
    setLoading(true);
    try {
      const out = await listSolutionPacks();
      setPacks(out?.items || out || []);
    } catch (err) {
      logger.error('Erro ao listar packs:', err);
      showToast('Erro ao listar packs', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleInstall(segment) {
    setLoading(true);
    try {
      const out = await installSolutionPack(segment);
      if (!out?.ok && out?.error) {
        showToast(`Falha ao instalar: ${out.error}`, 'error');
        return;
      }
      showToast('Pack instalado com sucesso!', 'success');
    } catch (err) {
      logger.error('Erro ao instalar pack:', err);
      showToast('Erro ao instalar pack', 'error');
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
        <h1 style={{ fontSize: '22px', marginBottom: '12px' }}>Solutions Packs</h1>
        <p style={{ color: '#6b7280', marginBottom: '20px' }}>
          Pacotes prontos por segmento para acelerar o go-live.
        </p>

        <div style={{ display: 'grid', gap: '12px' }}>
          {packs.map((p) => (
            <div key={p.id} style={{ border: '1px solid #eee', borderRadius: '8px', padding: '12px', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{p.name}</strong>
                  <div style={{ color: '#6b7280' }}>{p.description}</div>
                  <div style={{ color: '#9ca3af', fontSize: '12px' }}>Segmento: {p.segment}</div>
                </div>
                <button onClick={() => handleInstall(p.segment)} disabled={loading}>
                  Instalar pack
                </button>
              </div>
              {Array.isArray(p.operationsChecklist) && p.operationsChecklist.length > 0 && (
                <ul style={{ marginTop: '8px', color: '#6b7280' }}>
                  {p.operationsChecklist.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {packs.length === 0 && <div style={{ color: '#6b7280' }}>Nenhum pack disponível.</div>}
        </div>
      </div>
    </div>
  );
}
