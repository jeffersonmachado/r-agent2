import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { isSuperAdmin } from '../utils/menuPermissions';
import { CrudPageBase, useCrudList } from '../modules/crud-base';
import logger from '../utils/logger';
import { formatDateTime } from '../utils/dateFormatter';

const API_BASE = '/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================================
// Agent Registry Tab
// ============================================================
function AgentRegistryTab() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({
    name: '', slug: '', description: '', classification: 'DEVELOPMENT',
    capabilities: [], tools: [], knowledgeSources: [], department: '', owner: '',
  });

  const fetchAgents = useCallback(async () => {
    const data = await apiFetch(`${API_BASE}/agent-registry`);
    return data.agents || [];
  }, []);

  const { allItems: agents, loading, loadItems: reload } = useCrudList(fetchAgents);

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        capabilities: typeof formData.capabilities === 'string'
          ? formData.capabilities.split(',').map(s => s.trim()).filter(Boolean)
          : formData.capabilities,
        tools: typeof formData.tools === 'string'
          ? formData.tools.split(',').map(s => s.trim()).filter(Boolean)
          : formData.tools,
        knowledgeSources: typeof formData.knowledgeSources === 'string'
          ? formData.knowledgeSources.split(',').map(s => s.trim()).filter(Boolean)
          : formData.knowledgeSources,
      };

      if (editing) {
        await apiFetch(`${API_BASE}/agent-registry/${editing.id}`, {
          method: 'PUT', body: JSON.stringify(payload),
        });
        showToast('Agente atualizado', 'success');
      } else {
        await apiFetch(`${API_BASE}/agent-registry`, {
          method: 'POST', body: JSON.stringify(payload),
        });
        showToast('Agente criado', 'success');
      }
      setShowForm(false);
      setEditing(null);
      reload();
    } catch (err) {
      showToast(err.message, 'error');
      logger.error('Agent save error', err);
    }
  };

  const handleDelete = async (agent) => {
    if (!window.confirm(`Remover "${agent.name}"?`)) return;
    try {
      await apiFetch(`${API_BASE}/agent-registry/${agent.id}`, { method: 'DELETE' });
      showToast('Agente removido', 'success');
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const startEdit = (agent) => {
    setEditing(agent);
    setFormData({
      name: agent.name, slug: agent.slug, description: agent.description || '',
      classification: agent.classification, department: agent.department || '',
      owner: agent.owner || '',
      capabilities: agent.capabilities || [],
      tools: agent.tools || [],
      knowledgeSources: agent.knowledgeSources || [],
    });
    setShowForm(true);
  };

  const startCreate = () => {
    setEditing(null);
    setFormData({
      name: '', slug: '', description: '', classification: 'DEVELOPMENT',
      capabilities: [], tools: [], knowledgeSources: [], department: '', owner: '',
    });
    setShowForm(true);
  };

  if (loading) return <div className="p-6 text-center text-text-secondary">Carregando agentes...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Corporate Agents ({agents.length})</h3>
        <button onClick={startCreate} className="btn-primary px-4 py-2 rounded text-sm">+ Novo Agente</button>
      </div>

      {showForm && (
        <div className="bg-bg-elevated border border-border-default rounded-lg p-6 mb-6">
          <h4 className="font-medium mb-4 text-text-primary">{editing ? 'Editar' : 'Novo'} Agente Corporativo</h4>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Nome *</label>
                <input type="text" required value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Slug *</label>
                <input type="text" required value={formData.slug}
                  onChange={e => setFormData({ ...formData, slug: e.target.value })}
                  className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Descrição</label>
              <textarea value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Classificação</label>
                <select value={formData.classification}
                  onChange={e => setFormData({ ...formData, classification: e.target.value })}
                  className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary">
                  <option value="PRODUCTION">PRODUCTION</option>
                  <option value="SUPPORT">SUPPORT</option>
                  <option value="DEVELOPMENT">DEVELOPMENT</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Departamento</label>
                <input type="text" value={formData.department}
                  onChange={e => setFormData({ ...formData, department: e.target.value })}
                  className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Owner</label>
                <input type="text" value={formData.owner}
                  onChange={e => setFormData({ ...formData, owner: e.target.value })}
                  className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Capabilities (separadas por vírgula)</label>
              <input type="text"
                value={Array.isArray(formData.capabilities) ? formData.capabilities.join(', ') : formData.capabilities}
                onChange={e => setFormData({ ...formData, capabilities: e.target.value })}
                className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Tools (separadas por vírgula)</label>
              <input type="text"
                value={Array.isArray(formData.tools) ? formData.tools.join(', ') : formData.tools}
                onChange={e => setFormData({ ...formData, tools: e.target.value })}
                className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Knowledge Sources (separadas por vírgula)</label>
              <input type="text"
                value={Array.isArray(formData.knowledgeSources) ? formData.knowledgeSources.join(', ') : formData.knowledgeSources}
                onChange={e => setFormData({ ...formData, knowledgeSources: e.target.value })}
                className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded text-sm">Salvar</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-default px-4 py-2 rounded text-sm">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-bg-elevated border border-border-default rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-surface text-text-secondary">
            <tr>
              <th className="text-left px-4 py-2">Nome</th>
              <th className="text-left px-4 py-2">Slug</th>
              <th className="text-left px-4 py-2">Classificação</th>
              <th className="text-left px-4 py-2">Lifecycle</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Atualizado</th>
              <th className="text-right px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody className="text-text-primary">
            {agents.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-text-secondary">Nenhum agente corporativo encontrado.</td></tr>
            )}
            {agents.map(agent => (
              <tr key={agent.id} className="border-t border-border-default hover:bg-bg-surface">
                <td className="px-4 py-2 font-medium">{agent.name}</td>
                <td className="px-4 py-2 text-text-secondary">{agent.slug}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    agent.classification === 'PRODUCTION' ? 'bg-green-900 text-green-300' :
                    agent.classification === 'SUPPORT' ? 'bg-blue-900 text-blue-300' :
                    'bg-yellow-900 text-yellow-300'
                  }`}>{agent.classification}</span>
                </td>
                <td className="px-4 py-2 text-text-secondary">{agent.lifecycle}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    agent.status === 'active' ? 'bg-green-900 text-green-300' :
                    agent.status === 'draft' ? 'bg-gray-700 text-gray-300' :
                    'bg-yellow-900 text-yellow-300'
                  }`}>{agent.status}</span>
                </td>
                <td className="px-4 py-2 text-text-secondary text-xs">{formatDateTime(agent.updatedAt)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => startEdit(agent)} className="text-blue-400 hover:text-blue-300 mr-2 text-xs">Editar</button>
                  <button onClick={() => handleDelete(agent)} className="text-red-400 hover:text-red-300 text-xs">Remover</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Agent Factory Tab
// ============================================================
function AgentFactoryTab() {
  const { showToast } = useToast();
  const [workflowStep, setWorkflowStep] = useState('create');
  const [agentId, setAgentId] = useState(null);
  const [agentName, setAgentName] = useState('');
  const [agentSlug, setAgentSlug] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState('DEVELOPMENT');
  const [capabilities, setCapabilities] = useState('');
  const [tools, setTools] = useState('');
  const [knowledgeSources, setKnowledgeSources] = useState('');
  const [riskLevel, setRiskLevel] = useState('low');
  const [auditEnabled, setAuditEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const steps = [
    { key: 'create', label: '1. Create Agent', icon: '➕' },
    { key: 'configure', label: '2. Configure', icon: '⚙️' },
    { key: 'knowledge', label: '3. Knowledge', icon: '📚' },
    { key: 'validate', label: '4. QA Wave', icon: '✓' },
    { key: 'approve', label: '5. Approval', icon: '🔒' },
    { key: 'publish', label: '6. Publish', icon: '🚀' },
  ];

  const handleCreate = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`${API_BASE}/agent-factory/create`, {
        method: 'POST',
        body: JSON.stringify({ name: agentName, slug: agentSlug, description, classification }),
      });
      setAgentId(data.agent.id);
      setResult(data);
      setWorkflowStep('configure');
      showToast('Agente criado', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  };

  const handleConfigure = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`${API_BASE}/agent-factory/configure`, {
        method: 'POST',
        body: JSON.stringify({
          id: agentId,
          capabilities: capabilities.split(',').map(s => s.trim()).filter(Boolean),
          tools: tools.split(',').map(s => s.trim()).filter(Boolean),
          knowledgeSources: knowledgeSources.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      setResult(data);
      setWorkflowStep('validate');
      showToast('Agente configurado', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  };

  const handleValidate = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`${API_BASE}/agent-factory/validate`, {
        method: 'POST', body: JSON.stringify({ id: agentId, qaWaveResult: 'GO' }),
      });
      setResult(data);
      setWorkflowStep(data.qaWave?.status === 'GO' ? 'approve' : 'configure');
      showToast(`QA Wave: ${data.qaWave?.status || 'N/A'}`, data.qaWave?.status === 'GO' ? 'success' : 'error');
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  };

  const handleApprove = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`${API_BASE}/agent-factory/approve`, {
        method: 'POST', body: JSON.stringify({ id: agentId, riskLevel, auditEnabled }),
      });
      setResult(data);
      setWorkflowStep('publish');
      showToast('Agente aprovado', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  };

  const handlePublish = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`${API_BASE}/agent-factory/publish`, {
        method: 'POST', body: JSON.stringify({ id: agentId }),
      });
      setResult(data);
      showToast('Agente publicado em produção!', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-text-primary mb-4">Agent Factory</h3>

      {/* Step indicator */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {steps.map((step, i) => (
          <div key={step.key} className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap ${
            workflowStep === step.key ? 'bg-blue-600 text-white' :
            steps.findIndex(s => s.key === workflowStep) > i ? 'bg-green-800 text-green-300' :
            'bg-bg-surface text-text-secondary'
          }`}>
            <span>{step.icon}</span> {step.label}
          </div>
        ))}
      </div>

      {/* Step 1: Create */}
      {workflowStep === 'create' && (
        <div className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4">
          <h4 className="font-medium text-text-primary">Create Agent</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Nome *</label>
              <input type="text" value={agentName} onChange={e => setAgentName(e.target.value)}
                className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Slug *</label>
              <input type="text" value={agentSlug} onChange={e => setAgentSlug(e.target.value)}
                className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Descrição</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" rows={3} />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Classificação</label>
            <select value={classification} onChange={e => setClassification(e.target.value)}
              className="bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary">
              <option value="PRODUCTION">PRODUCTION</option>
              <option value="SUPPORT">SUPPORT</option>
              <option value="DEVELOPMENT">DEVELOPMENT</option>
            </select>
          </div>
          <button onClick={handleCreate} disabled={loading || !agentName || !agentSlug}
            className="btn-primary px-6 py-2 rounded text-sm disabled:opacity-50">
            {loading ? 'Criando...' : 'Criar Agente'}
          </button>
        </div>
      )}

      {/* Step 2: Configure */}
      {workflowStep === 'configure' && (
        <div className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4">
          <h4 className="font-medium text-text-primary">Configure & Knowledge</h4>
          <p className="text-sm text-text-secondary">Agent ID: {agentId}</p>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Capabilities</label>
            <input type="text" value={capabilities} onChange={e => setCapabilities(e.target.value)}
              placeholder="lead_qualification, follow_up, meeting_scheduling"
              className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Tools</label>
            <input type="text" value={tools} onChange={e => setTools(e.target.value)}
              placeholder="crm_integration, calendar, whatsapp"
              className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Knowledge Sources</label>
            <input type="text" value={knowledgeSources} onChange={e => setKnowledgeSources(e.target.value)}
              placeholder="crm, product_docs, sales_playbook"
              className="w-full bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary" />
          </div>
          <button onClick={handleConfigure} disabled={loading}
            className="btn-primary px-6 py-2 rounded text-sm disabled:opacity-50">
            {loading ? 'Salvando...' : 'Salvar Configuração'}
          </button>
        </div>
      )}

      {/* Step 3: Validate (QA Wave) */}
      {workflowStep === 'validate' && (
        <div className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4">
          <h4 className="font-medium text-text-primary">QA Wave Validation</h4>
          <p className="text-sm text-text-secondary">Submeta o agente para validação QA Wave.</p>
          <div className="bg-yellow-900/30 border border-yellow-700 rounded p-4 text-sm text-yellow-300">
            ⚠️ Toda publicação obrigatoriamente passa por QA Wave. Critério: GO ou NO_GO.
          </div>
          <button onClick={handleValidate} disabled={loading}
            className="btn-primary px-6 py-2 rounded text-sm disabled:opacity-50">
            {loading ? 'Validando...' : 'Executar QA Wave'}
          </button>
        </div>
      )}

      {/* Step 4: Approve */}
      {workflowStep === 'approve' && (
        <div className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4">
          <h4 className="font-medium text-text-primary">Governance Approval</h4>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Risk Level</label>
            <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)}
              className="bg-bg-surface border border-border-default rounded px-3 py-2 text-sm text-text-primary">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="auditEnabled" checked={auditEnabled}
              onChange={e => setAuditEnabled(e.target.checked)} />
            <label htmlFor="auditEnabled" className="text-sm text-text-secondary">Audit Enabled</label>
          </div>
          <button onClick={handleApprove} disabled={loading}
            className="btn-primary px-6 py-2 rounded text-sm disabled:opacity-50">
            {loading ? 'Aprovando...' : 'Aprovar Agente'}
          </button>
        </div>
      )}

      {/* Step 5: Publish */}
      {workflowStep === 'publish' && (
        <div className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4">
          <h4 className="font-medium text-text-primary">Publish to Production</h4>
          <p className="text-sm text-text-secondary">O agente está aprovado e pronto para produção.</p>
          {result?.qaWave && (
            <div className="bg-green-900/30 border border-green-700 rounded p-4">
              <span className="text-green-300 text-sm font-medium">QA Wave: {result.qaWave.status}</span>
              <div className="text-green-400 text-xs mt-1">
                Checks: {(result.qaWave.checks || []).join(', ')}
              </div>
            </div>
          )}
          <button onClick={handlePublish} disabled={loading}
            className="btn-primary px-6 py-2 rounded text-sm disabled:opacity-50">
            {loading ? 'Publicando...' : '🚀 Publicar Agente'}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Agent Marketplace Tab
// ============================================================
function AgentMarketplaceTab() {
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');

  useEffect(() => {
    loadCatalog();
  }, [selectedCategory]);

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const params = selectedCategory ? `?category=${selectedCategory}` : '';
      const data = await apiFetch(`${API_BASE}/agent-marketplace/catalog${params}`);
      setCatalog(data.catalog || []);
    } catch (err) {
      showToast('Erro ao carregar catálogo', 'error');
    }
    setLoading(false);
  };

  const handleInstall = async (agent) => {
    try {
      await apiFetch(`${API_BASE}/agent-marketplace/install`, {
        method: 'POST', body: JSON.stringify({ slug: agent.slug }),
      });
      showToast(`${agent.name} instalado com sucesso!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const categories = ['', 'sales', 'crm', 'support', 'operations', 'finance', 'marketing', 'knowledge', 'qa', 'analytics', 'development'];

  if (loading) return <div className="p-6 text-center text-text-secondary">Carregando marketplace...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Agent Marketplace</h3>
        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
          className="bg-bg-surface border border-border-default rounded px-3 py-1.5 text-sm text-text-primary">
          <option value="">Todas categorias</option>
          {categories.filter(Boolean).map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {catalog.map(agent => (
          <div key={agent.slug} className="bg-bg-elevated border border-border-default rounded-lg p-5 hover:border-blue-600 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <h4 className="font-semibold text-text-primary">{agent.name}</h4>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                agent.classification === 'PRODUCTION' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
              }`}>{agent.classification}</span>
            </div>
            <p className="text-sm text-text-secondary mb-3">{agent.description}</p>
            <div className="text-xs text-text-secondary mb-3">
              <span className="font-medium">Categoria:</span> {agent.category}
            </div>
            <div className="flex flex-wrap gap-1 mb-4">
              {(agent.capabilities || []).slice(0, 3).map(cap => (
                <span key={cap} className="px-2 py-0.5 bg-bg-surface rounded text-xs text-text-secondary">{cap}</span>
              ))}
              {(agent.capabilities || []).length > 3 && (
                <span className="px-2 py-0.5 bg-bg-surface rounded text-xs text-text-secondary">
                  +{agent.capabilities.length - 3}
                </span>
              )}
            </div>
            <button onClick={() => handleInstall(agent)}
              className="w-full btn-primary px-4 py-2 rounded text-sm">
              Instalar
            </button>
          </div>
        ))}
      </div>

      {catalog.length === 0 && (
        <div className="text-center text-text-secondary py-12">Nenhum agente encontrado no marketplace.</div>
      )}
    </div>
  );
}

// ============================================================
// Quick Overview Tab (FASE 4-10 summary)
// ============================================================
function AgentOsOverviewTab() {
  return (
    <div className="space-y-6">
      <div className="bg-bg-elevated border border-border-default rounded-lg p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-2">Agent Operating System</h3>
        <p className="text-sm text-text-secondary mb-4">
          O RAP Agent OS transforma agentes de IA em ativos corporativos governados,
          com ciclo de vida completo: criação, validação, publicação, execução e aprendizado contínuo.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🏭</div>
            <div className="text-sm font-medium text-text-primary">Agent Registry</div>
            <div className="text-xs text-text-secondary">Catálogo corporativo</div>
          </div>
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🏗️</div>
            <div className="text-sm font-medium text-text-primary">Agent Factory</div>
            <div className="text-xs text-text-secondary">Criação com QA Wave</div>
          </div>
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🕸️</div>
            <div className="text-sm font-medium text-text-primary">Knowledge Graph</div>
            <div className="text-xs text-text-secondary">Grafo corporativo</div>
          </div>
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🗺️</div>
            <div className="text-sm font-medium text-text-primary">Journey Registry</div>
            <div className="text-xs text-text-secondary">Jornadas de negócio</div>
          </div>
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🧠</div>
            <div className="text-sm font-medium text-text-primary">RAP Learn</div>
            <div className="text-xs text-text-secondary">Aprendizado contínuo</div>
          </div>
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🛡️</div>
            <div className="text-sm font-medium text-text-primary">AI Governance</div>
            <div className="text-xs text-text-secondary">Audit & Compliance</div>
          </div>
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🏪</div>
            <div className="text-sm font-medium text-text-primary">Marketplace</div>
            <div className="text-xs text-text-secondary">Catálogo de agentes</div>
          </div>
          <div className="bg-bg-surface rounded-lg p-4 text-center">
            <div className="text-2xl mb-1">🎯</div>
            <div className="text-sm font-medium text-text-primary">Vertical Templates</div>
            <div className="text-xs text-text-secondary">Templates por setor</div>
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated border border-border-default rounded-lg p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-2">Classificação de Agentes</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="bg-green-900/30 border border-green-700 rounded p-4">
            <div className="font-medium text-green-300 mb-1">PRODUCTION</div>
            <div className="text-green-400 text-xs">Visível para usuários operacionais. Agentes que executam tarefas de negócio.</div>
          </div>
          <div className="bg-blue-900/30 border border-blue-700 rounded p-4">
            <div className="font-medium text-blue-300 mb-1">SUPPORT</div>
            <div className="text-blue-400 text-xs">Visível para suporte. Agentes de diagnóstico, replay e evidência.</div>
          </div>
          <div className="bg-yellow-900/30 border border-yellow-700 rounded p-4">
            <div className="font-medium text-yellow-300 mb-1">DEVELOPMENT</div>
            <div className="text-yellow-400 text-xs">Restrito à engenharia. Agentes de QA, teste e desenvolvimento.</div>
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated border border-border-default rounded-lg p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-2">Pipeline de Aprendizado</h3>
        <div className="text-sm text-text-secondary">
          <code className="bg-bg-surface px-2 py-0.5 rounded text-xs">
            Failure → Classification → Clustering → Root Cause → Suggestion → Validation → Promotion
          </code>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          Nenhuma correção é aplicada diretamente em produção. Toda sugestão passa por QA Wave antes da promoção.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Main Agent OS Hub Page
// ============================================================
const TABS = [
  { key: 'overview', label: 'Visão Geral', component: AgentOsOverviewTab },
  { key: 'registry', label: 'Agent Registry', component: AgentRegistryTab },
  { key: 'factory', label: 'Agent Factory', component: AgentFactoryTab },
  { key: 'marketplace', label: 'Marketplace', component: AgentMarketplaceTab },
];

export function AgentOsHubPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen text-text-secondary">Carregando...</div>;
  }

  if (!isAuthenticated) return null;

  if (!isSuperAdmin(currentAgent)) {
    return (
      <div className="flex items-center justify-center min-h-screen text-text-secondary">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Acesso Restrito</h2>
          <p className="text-sm">Esta área é reservada para Super Administradores.</p>
        </div>
      </div>
    );
  }

  const ActiveComponent = TABS.find(t => t.key === activeTab)?.component || AgentOsOverviewTab;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Agent Operating System</h1>
        <p className="text-sm text-text-secondary mt-1">
          Gerencie agentes corporativos, factory, marketplace e governança de IA.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-default">
        {TABS.map(tab => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <ActiveComponent />
    </div>
  );
}

export default AgentOsHubPage;
