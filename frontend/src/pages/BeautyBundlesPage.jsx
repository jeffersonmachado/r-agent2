import React, { useEffect, useState } from 'react';
import { listBeautyBundles, createBeautyBundle } from '../api/verticalOperations';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';

export function BeautyBundlesPage() {
  const { showToast, ToastContainer } = useToast();
  const [subjectId, setSubjectId] = useState('');
  const [amount, setAmount] = useState('99.9');
  const [totalSessions, setTotalSessions] = useState('10');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);

  async function loadData() {
    try {
      const out = await listBeautyBundles({
        limit: 200,
        subjectId: subjectId || undefined,
        status: status || undefined,
      });
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (_) {
      showToast('Erro ao carregar bundles', 'error');
    }
  }

  async function createBundle() {
    if (!subjectId) {
      showToast('Informe o subjectId', 'warning');
      return;
    }
    try {
      await createBeautyBundle({
        subjectId,
        bundleType: 'package',
        totalSessions: Number(totalSessions),
        planName: 'Beauty Premium',
        charge: {
          amount: Number(amount),
          dueDate: new Date(Date.now() + 24 * 3600000).toISOString(),
          metadata: { source: 'beauty_bundles_page' },
        },
      });
      showToast('Bundle criado com cobrança', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao criar bundle', 'error');
    }
  }

  // Refresh sob demanda via WebSocket: o backend emite
  // `vertical.bundles.updated` quando um bundle é vendido ou consumido.
  useWebSocketContext({
    onEvent: (event) => {
      if (event === 'vertical.bundles.updated') {
        loadData();
      }
    },
    subscribeEvents: ['vertical.bundles.updated'],
  });

  useEffect(() => {
    loadData();
    // Realtime por PUSH: `vertical.bundles.updated` via WebSocket (acima). Sem
    // polling — a regra do projeto proibe setInterval para sincronizar estado.
    // Ao voltar para a aba, revalidamos uma vez por evento.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadData();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [status]);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Bundles Beauty</h1>
        <p className="text-sm text-text-secondary">Pacotes e bundles ativos, com apoio a criação + cobrança no mesmo fluxo.</p>
      </div>
      <div className="support-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input className="support-input" placeholder="subjectId" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} />
        <select className="support-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="active">active</option>
          <option value="exhausted">exhausted</option>
          <option value="expired">expired</option>
          <option value="cancelled">cancelled</option>
        </select>
        <input className="support-input" placeholder="total sessions" value={totalSessions} onChange={(e) => setTotalSessions(e.target.value)} />
        <input className="support-input" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="support-button" onClick={createBundle}>Criar bundle + cobrar</button>
        <button className="support-button" onClick={loadData}>Atualizar</button>
      </div>
      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        {!items.length ? <p className="text-sm text-text-secondary">Nenhum bundle encontrado.</p> : (
          <table className="support-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Billing</th>
                <th>Sessões</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.subject_id}</td>
                  <td>{item.status}</td>
                  <td>{item.billing_status}</td>
                  <td>{item.used_sessions}/{item.total_sessions ?? 'inf'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ToastContainer />
    </div>
  );
}
