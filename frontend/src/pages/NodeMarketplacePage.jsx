import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { listNodeCatalog } from '../api/nodeMarketplace';

export function NodeMarketplacePage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState([]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadCatalog();
    }
  }, [authLoading, isAuthenticated]);

  async function loadCatalog() {
    setLoading(true);
    try {
      const out = await listNodeCatalog();
      setCatalog(out?.items || []);
    } catch (err) {
      logger.error('Erro ao listar catálogo:', err);
      showToast('Erro ao carregar catálogo', 'error');
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
        <h1 style={{ fontSize: '22px', marginBottom: '12px' }}>Node Marketplace</h1>
        <p style={{ color: '#6b7280', marginBottom: '20px' }}>
          Catálogo interno de nodes disponíveis para o runtime.
        </p>

        {loading ? (
          <div style={{ color: '#6b7280' }}>Carregando catálogo...</div>
        ) : (
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr>
                <th align="left">Node</th>
                <th align="left">Categoria</th>
                <th align="left">Versão</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((n) => (
                <tr key={n.id}>
                  <td>{n.label}</td>
                  <td>{n.category}</td>
                  <td>{n.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
