import React, { useEffect, useState } from 'react';
import { listOpenFitnessAttendances } from '../api/verticalOperations';
import { registerFitnessCheckOut } from '../api/verticalPilot';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';

export function FitnessAttendancePage() {
  const { showToast, ToastContainer } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const out = await listOpenFitnessAttendances({ limit: 100 });
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (_) {
      showToast('Erro ao carregar atendimentos abertos', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Refresh sob demanda via WebSocket: o backend emite
  // `vertical.attendance.updated` em check-in/check-out/no-show.
  useWebSocketContext({
    onEvent: (event) => {
      if (event === 'vertical.attendance.updated') {
        loadData();
      }
    },
    subscribeEvents: ['vertical.attendance.updated'],
  });

  async function closeAttendance(item) {
    try {
      await registerFitnessCheckOut({ subjectId: item.subject_id, attendanceId: item.id, metadata: { source: 'fitness_attendance_page' } });
      showToast('Atendimento encerrado', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao encerrar atendimento', 'error');
    }
  }

  useEffect(() => {
    loadData();
    // Poll de 120s: fallback caso o evento WS não chegue
    const timer = setInterval(loadData, 120000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header"><h1>Presença Fitness</h1></div>
      <button
        className="support-button"
        data-testid="refresh-button"
        aria-label="Atualizar attendance"
        onClick={loadData}
        disabled={loading}
      >{loading ? 'Atualizando...' : 'Atualizar'}</button>
      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        <table className="support-table">
          <thead>
            <tr>
              <th>Presença</th>
              <th>Aluno</th>
              <th>Entrada</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.subject_id}</td>
                <td>{item.checked_in_at ? new Date(item.checked_in_at).toLocaleString() : '-'}</td>
                <td><button className="support-button" onClick={() => closeAttendance(item)}>Encerrar presença</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ToastContainer />
    </div>
  );
}
