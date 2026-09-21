import React, { useCallback, useEffect, useState } from 'react';
import { listEngineeringModels } from '../api/engineeringRouter';
import { useToast } from '../components/Toast';

function Pill({ children, tone }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs mr-1 mb-1 border ${tone || 'bg-bg-subtle border-border-default text-text-secondary'}`}>{children}</span>;
}

export function EngineeringModelsPage() {
  const { showToast, ToastContainer } = useToast();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listEngineeringModels();
      setModels(result.models || []);
    } catch (err) {
      showToast?.(err.message || 'Falha ao carregar modelos', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ToastContainer />
      <h1 className="text-2xl font-bold text-text-primary mb-2">Models / Model Router</h1>
      <p className="text-sm text-text-secondary mb-6">
        Registry real ({'engine/aiProviderRegistry.js'}) estendido com capabilities/roles do Engineering Router V1. Nenhuma chave/segredo é exibida aqui.
      </p>

      {loading ? (
        <div className="text-sm text-text-secondary">Carregando…</div>
      ) : (
        <div className="bg-bg-elevated rounded-xl border border-border-default overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-text-secondary">
                <th className="p-3">Modelo</th>
                <th className="p-3">Status</th>
                <th className="p-3">Roles</th>
                <th className="p-3">Capabilities</th>
                <th className="p-3">Contexto</th>
                <th className="p-3">Custo</th>
                <th className="p-3">Telemetria</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={`${m.providerId}:${m.modelId}`} className="border-b border-border-default last:border-0 align-top">
                  <td className="p-3 text-text-primary font-medium">{m.providerId}:{m.modelId}</td>
                  <td className="p-3">
                    {!m.enabled && <Pill tone="bg-bg-subtle border-border-default text-text-secondary">disabled</Pill>}
                    {m.enabled && !m.hasCredential && <Pill tone="bg-amber-500/15 border-amber-500/30 text-amber-500">sem credencial</Pill>}
                    {m.enabled && m.hasCredential && !m.healthy && <Pill tone="bg-red-500/15 border-red-500/30 text-red-500">unhealthy</Pill>}
                    {m.enabled && m.hasCredential && m.healthy && <Pill tone="bg-emerald-500/15 border-emerald-500/30 text-emerald-500">ready</Pill>}
                  </td>
                  <td className="p-3">{m.roles.map((r) => <Pill key={r}>{r}</Pill>)}</td>
                  <td className="p-3 max-w-xs">{m.capabilities.map((c) => <Pill key={c}>{c}</Pill>)}</td>
                  <td className="p-3 text-text-secondary">{m.contextClass}</td>
                  <td className="p-3 text-text-secondary">{m.costClass}</td>
                  <td className="p-3 text-text-secondary text-xs">
                    tasks: {m.telemetry.tasks} · ok: {m.telemetry.successes} · falhas: {m.telemetry.failures}
                    {m.telemetry.averageLatencyMs != null && <> · lat: {m.telemetry.averageLatencyMs}ms</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default EngineeringModelsPage;
