import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { listAutomations, upsertAutomation, publishAutomation, runAutomation } from '../api/automations';
import logger from '../utils/logger';

const DEFAULT_DEFINITION = {
  trigger: 'manual',
  steps: [],
};

const STEP_TEMPLATES = [
  { key: 'send_message', label: 'Enviar mensagem', description: 'Envia mensagem por canal', defaults: { channel: 'whatsapp', message: 'Olá! 👋' } },
  { key: 'assign_queue', label: 'Atribuir fila', description: 'Encaminha para fila operacional', defaults: { queue: 'default' } },
  { key: 'add_tag', label: 'Adicionar tag', description: 'Marca ticket/conversa', defaults: { tag: 'prioridade' } },
  { key: 'wait', label: 'Aguardar', description: 'Espera por um tempo', defaults: { waitMs: 300000 } },
  { key: 'run_webhook', label: 'Webhook', description: 'Chama endpoint externo', defaults: { url: 'https://example.com/hook', method: 'POST' } },
];

function safeJsonParse(text) {
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function normalizeDefinition(input) {
  const value = input && typeof input === 'object' ? input : {};
  const trigger = typeof value.trigger === 'string' && value.trigger.trim() ? value.trigger.trim() : DEFAULT_DEFINITION.trigger;
  const sourceSteps = Array.isArray(value.steps) ? value.steps : [];
  const steps = sourceSteps.map((step, index) => ({
    id: typeof step?.id === 'string' && step.id.trim() ? step.id : `step-${Date.now()}-${index}`,
    type: typeof step?.type === 'string' && step.type.trim() ? step.type : 'custom',
    name: typeof step?.name === 'string' && step.name.trim() ? step.name : '',
    ...step,
  }));
  return { ...value, trigger, steps };
}

function createStep(templateKey) {
  const template = STEP_TEMPLATES.find((t) => t.key === templateKey);
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: template?.key || 'custom',
    name: template?.label || 'Passo customizado',
    ...(template?.defaults || {}),
  };
}

function formatStepTitle(step, index) {
  const template = STEP_TEMPLATES.find((t) => t.key === step?.type);
  const base = template?.label || step?.name || step?.type || 'Passo';
  return `${index + 1}. ${base}`;
}

function formatAiAnalysisSummary(aiAnalysis) {
  if (!aiAnalysis || typeof aiAnalysis !== 'object') return '-';
  const sentiment = String(aiAnalysis.sentiment || '').trim();
  const intent = String(aiAnalysis.intent || '').trim();
  const parts = [];
  if (sentiment) parts.push(`Sentimento: ${sentiment}`);
  if (intent) parts.push(`Intenção: ${intent}`);
  if (parts.length === 0) return 'Sem dados';
  return parts.join(' • ');
}

export function AutomationsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [automations, setAutomations] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    definitionJson: '{\n  "trigger": "manual",\n  "steps": []\n}',
  });
  const [definition, setDefinition] = useState(DEFAULT_DEFINITION);
  const [jsonError, setJsonError] = useState('');
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [dragStepId, setDragStepId] = useState(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  function syncJsonWithDefinition(nextDefinition) {
    const normalized = normalizeDefinition(nextDefinition);
    setDefinition(normalized);
    setForm((prev) => ({
      ...prev,
      definitionJson: JSON.stringify(normalized, null, 2),
    }));
    setJsonError('');
  }

  function handleDefinitionJsonChange(text) {
    setForm((prev) => ({ ...prev, definitionJson: text }));
    const parsed = safeJsonParse(text);
    if (!parsed.ok) {
      setJsonError(parsed.error || 'JSON inválido');
      return;
    }
    setJsonError('');
    setDefinition(normalizeDefinition(parsed.value));
  }

  function handleAddStep(templateKey) {
    const nextStep = createStep(templateKey);
    const nextDefinition = {
      ...definition,
      steps: [...(definition.steps || []), nextStep],
    };
    syncJsonWithDefinition(nextDefinition);
    setSelectedStepId(nextStep.id);
  }

  function handleRemoveStep(stepId) {
    const nextSteps = (definition.steps || []).filter((step) => step.id !== stepId);
    syncJsonWithDefinition({
      ...definition,
      steps: nextSteps,
    });
    if (selectedStepId === stepId) {
      setSelectedStepId(nextSteps[0]?.id || null);
    }
  }

  function handleStepPatch(stepId, patch) {
    const nextSteps = (definition.steps || []).map((step) => (step.id === stepId ? { ...step, ...patch } : step));
    syncJsonWithDefinition({
      ...definition,
      steps: nextSteps,
    });
  }

  function moveStep(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const currentSteps = [...(definition.steps || [])];
    const fromIndex = currentSteps.findIndex((step) => step.id === fromId);
    const toIndex = currentSteps.findIndex((step) => step.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = currentSteps.splice(fromIndex, 1);
    currentSteps.splice(toIndex, 0, moved);
    syncJsonWithDefinition({
      ...definition,
      steps: currentSteps,
    });
  }

  const selectedStep = (definition.steps || []).find((step) => step.id === selectedStepId) || null;

  async function load() {
    setLoading(true);
    try {
      const out = await listAutomations();
      setAutomations(Array.isArray(out?.automations) ? out.automations : []);
    } catch (err) {
      logger.error('[Automations] erro ao carregar', err);
      showToast('Erro ao carregar automações', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      load();
    }
  }, [authLoading, isAuthenticated]);

  async function handleSave() {
    if (!form.name.trim()) {
      showToast('Informe um nome para a automação', 'warning');
      return;
    }
    const parsed = safeJsonParse(form.definitionJson);
    if (!parsed.ok) {
      showToast(`JSON inválido: ${parsed.error}`, 'error');
      return;
    }
    setLoading(true);
    try {
      await upsertAutomation({
        id: editingId,
        name: form.name.trim(),
        description: form.description.trim(),
        definition: parsed.value,
      });
      setEditingId(null);
      setForm({
        name: '',
        description: '',
        definitionJson: '{\n  "trigger": "manual",\n  "steps": []\n}',
      });
      setDefinition(DEFAULT_DEFINITION);
      setSelectedStepId(null);
      setJsonError('');
      await load();
      showToast('Automação salva', 'success');
    } catch (err) {
      showToast('Erro ao salvar automação', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(item) {
    const normalized = normalizeDefinition(item.definition || {});
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      description: item.description || '',
      definitionJson: JSON.stringify(normalized, null, 2),
    });
    setDefinition(normalized);
    setSelectedStepId(normalized.steps[0]?.id || null);
    setJsonError('');
  }

  async function handlePublish(id) {
    setLoading(true);
    try {
      await publishAutomation(id);
      await load();
      showToast('Automação publicada', 'success');
    } catch (err) {
      showToast('Erro ao publicar automação', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRun(id) {
    setLoading(true);
    try {
      await runAutomation(id);
      await load();
      showToast('Execução enfileirada', 'success');
    } catch (err) {
      showToast('Erro ao executar automação', 'error');
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
      <div className="support-header">
        <h1>🧩 Automações</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <Button onClick={load} disabled={loading} className="support-button">Atualizar</Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr', gap: '16px' }}>
        <div className="support-details-panel">
          <div className="support-details-title">{editingId ? 'Editar automação' : 'Nova automação'}</div>
          <div className="support-form-group">
            <label className="support-form-label">Nome</label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Descrição</label>
            <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Builder visual (drag-and-drop)</label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '220px 1fr 320px',
                gap: '12px',
              }}
            >
              <div style={{ border: '1px solid var(--border-default)', borderRadius: '8px', padding: '10px' }}>
                <div className="text-xs text-text-secondary" style={{ marginBottom: '8px', fontWeight: 600 }}>Blocos</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {STEP_TEMPLATES.map((template) => (
                    <button
                      key={template.key}
                      type="button"
                      onClick={() => handleAddStep(template.key)}
                      className="support-button"
                      style={{ width: '100%', textAlign: 'left', padding: '8px' }}
                    >
                      <div style={{ fontWeight: 600 }}>{template.label}</div>
                      <div className="text-xs text-text-tertiary">{template.description}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ border: '1px solid var(--border-default)', borderRadius: '8px', padding: '10px' }}>
                <div className="support-form-group" style={{ marginBottom: '10px' }}>
                  <label className="support-form-label">Gatilho</label>
                  <select
                    value={definition.trigger || 'manual'}
                    onChange={(e) => syncJsonWithDefinition({ ...definition, trigger: e.target.value })}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                  >
                    <option value="manual">manual</option>
                    <option value="new_message">new_message</option>
                    <option value="ticket_created">ticket_created</option>
                    <option value="ticket_updated">ticket_updated</option>
                  </select>
                </div>
                <div className="text-xs text-text-secondary" style={{ marginBottom: '8px', fontWeight: 600 }}>
                  Fluxo ({(definition.steps || []).length} passo(s))
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '120px' }}>
                  {(definition.steps || []).length === 0 ? (
                    <div className="text-xs text-text-tertiary">Adicione blocos para montar a automação.</div>
                  ) : (
                    definition.steps.map((step, index) => (
                      <div
                        key={step.id}
                        draggable
                        onDragStart={() => setDragStepId(step.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          moveStep(dragStepId, step.id);
                          setDragStepId(null);
                        }}
                        onDragEnd={() => setDragStepId(null)}
                        onClick={() => setSelectedStepId(step.id)}
                        style={{
                          border: `1px solid ${selectedStepId === step.id ? 'var(--brand-primary)' : 'var(--border-default)'}`,
                          borderRadius: '8px',
                          padding: '10px',
                          background: selectedStepId === step.id ? 'var(--bg-secondary)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <div style={{ fontWeight: 600 }}>{formatStepTitle(step, index)}</div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveStep(step.id);
                            }}
                            className="support-button"
                            style={{ width: 'auto', padding: '4px 8px' }}
                          >
                            Remover
                          </button>
                        </div>
                        <div className="text-xs text-text-tertiary">
                          Arraste para reordenar
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div style={{ border: '1px solid var(--border-default)', borderRadius: '8px', padding: '10px' }}>
                <div className="text-xs text-text-secondary" style={{ marginBottom: '8px', fontWeight: 600 }}>Configuração do passo</div>
                {!selectedStep ? (
                  <div className="text-xs text-text-tertiary">Selecione um passo para editar seus campos.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className="support-form-group">
                      <label className="support-form-label">Nome</label>
                      <Input
                        value={selectedStep.name || ''}
                        onChange={(e) => handleStepPatch(selectedStep.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="support-form-group">
                      <label className="support-form-label">Tipo</label>
                      <Input
                        value={selectedStep.type || ''}
                        onChange={(e) => handleStepPatch(selectedStep.id, { type: e.target.value })}
                      />
                    </div>
                    <div className="support-form-group">
                      <label className="support-form-label">Parâmetros (JSON)</label>
                      <textarea
                        value={JSON.stringify(
                          Object.fromEntries(
                            Object.entries(selectedStep).filter(([key]) => !['id', 'name', 'type'].includes(key)),
                          ),
                          null,
                          2,
                        )}
                        onChange={(e) => {
                          const parsed = safeJsonParse(e.target.value);
                          if (!parsed.ok) return;
                          handleStepPatch(selectedStep.id, {
                            id: selectedStep.id,
                            name: selectedStep.name,
                            type: selectedStep.type,
                            ...parsed.value,
                          });
                        }}
                        rows={8}
                        className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Definição (JSON)</label>
            <textarea
              value={form.definitionJson}
              onChange={(e) => handleDefinitionJsonChange(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-xs"
              rows={10}
              disabled={loading}
            />
            {jsonError && <div className="text-xs" style={{ color: 'var(--status-error)', marginTop: '6px' }}>JSON inválido: {jsonError}</div>}
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} className="support-button-full" disabled={loading}>
              {editingId ? 'Salvar alterações' : 'Criar automação'}
            </Button>
            {editingId && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingId(null);
                  setForm({ name: '', description: '', definitionJson: '{\n  "trigger": "manual",\n  "steps": []\n}' });
                }}
                disabled={loading}
              >
                Cancelar
              </Button>
            )}
          </div>
          <div className="text-xs text-text-tertiary" style={{ marginTop: '8px' }}>
            Builder visual em primeiro corte: adicione e reordene passos por drag-and-drop; o JSON permanece editável.
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Lista</div>
          {automations.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma automação cadastrada.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="support-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Status</th>
                    <th>Publicado em</th>
                    <th>Última execução</th>
                    <th>Análise IA</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {automations.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.status || 'draft'}</td>
                      <td>{a.publishedAt || '-'}</td>
                      <td>{a.lastRunAt || '-'}</td>
                      <td>{formatAiAnalysisSummary(a.lastRunAiAnalysis)}</td>
                      <td>
                        <div className="flex gap-2">
                          <Button onClick={() => handleEdit(a)} style={{ width: 'auto' }}>Editar</Button>
                          <Button onClick={() => handlePublish(a.id)} style={{ width: 'auto' }} disabled={loading}>
                            Publicar
                          </Button>
                          <Button onClick={() => handleRun(a.id)} style={{ width: 'auto' }} disabled={loading}>
                            Executar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
