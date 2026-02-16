import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import {
  getWhatsAppIvr,
  updateWhatsAppIvr,
  upsertWhatsAppIvrDepartment,
  upsertWhatsAppIvrRule,
} from '../api/whatsappIvr';
import logger from '../utils/logger';

export function WhatsAppIvrPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [rules, setRules] = useState([]);

  const [deptData, setDeptData] = useState({ name: '', queue: '', enabled: true });
  const [ruleData, setRuleData] = useState({ keyword: '', departmentId: '', priority: 0, enabled: true });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function loadIvr() {
    setLoading(true);
    try {
      const out = await getWhatsAppIvr();
      const value = out?.value || {};
      setEnabled(value.enabled === true);
      setDepartments(Array.isArray(value.departments) ? value.departments : []);
      setRules(Array.isArray(value.rules) ? value.rules : []);
    } catch (err) {
      logger.error('[WhatsAppIVR] erro ao carregar', err);
      showToast('Erro ao carregar IVR', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadIvr();
    }
  }, [authLoading, isAuthenticated]);

  async function handleToggle(next) {
    setEnabled(next);
    try {
      await updateWhatsAppIvr({ enabled: next, departments, rules });
      showToast('Configuração atualizada', 'success');
    } catch (err) {
      setEnabled(!next);
      showToast('Falha ao atualizar', 'error');
    }
  }

  async function handleSaveDepartment() {
    if (!deptData.name || !deptData.queue) {
      showToast('Informe nome e fila', 'warning');
      return;
    }
    setLoading(true);
    try {
      await upsertWhatsAppIvrDepartment(deptData);
      setDeptData({ name: '', queue: '', enabled: true });
      await loadIvr();
      showToast('Departamento salvo', 'success');
    } catch (err) {
      showToast('Erro ao salvar departamento', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRule() {
    if (!ruleData.keyword || !ruleData.departmentId) {
      showToast('Informe palavra-chave e departamento', 'warning');
      return;
    }
    setLoading(true);
    try {
      await upsertWhatsAppIvrRule(ruleData);
      setRuleData({ keyword: '', departmentId: '', priority: 0, enabled: true });
      await loadIvr();
      showToast('Regra salva', 'success');
    } catch (err) {
      showToast('Erro ao salvar regra', 'error');
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
        <h1>💬 URA WhatsApp</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => handleToggle(e.target.checked)} />
            <span>{enabled ? 'Ativo' : 'Inativo'}</span>
          </label>
          <Button onClick={loadIvr} disabled={loading} className="support-button">Atualizar</Button>
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
          <div className="support-details-title">Departamentos</div>
          <div className="support-form-group">
            <label className="support-form-label">Nome</label>
            <input className="support-form-input" value={deptData.name} onChange={(e) => setDeptData({ ...deptData, name: e.target.value })} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Fila</label>
            <input className="support-form-input" value={deptData.queue} onChange={(e) => setDeptData({ ...deptData, queue: e.target.value })} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deptData.enabled} onChange={(e) => setDeptData({ ...deptData, enabled: e.target.checked })} />
            <span>Ativo</span>
          </label>
          <Button onClick={handleSaveDepartment} className="support-button-full">Salvar departamento</Button>

          <div style={{ marginTop: '12px', overflowX: 'auto' }}>
            <table className="support-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Fila</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {departments.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>Nenhum departamento</td></tr>
                )}
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>{d.queue}</td>
                    <td>{d.enabled ? 'Ativo' : 'Inativo'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Regras</div>
          <div className="support-form-group">
            <label className="support-form-label">Palavra-chave</label>
            <input className="support-form-input" value={ruleData.keyword} onChange={(e) => setRuleData({ ...ruleData, keyword: e.target.value })} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Departamento</label>
            <select className="support-form-select" value={ruleData.departmentId} onChange={(e) => setRuleData({ ...ruleData, departmentId: e.target.value })}>
              <option value="">Selecione</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Prioridade</label>
            <input className="support-form-input" type="number" value={ruleData.priority} onChange={(e) => setRuleData({ ...ruleData, priority: Number(e.target.value) })} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ruleData.enabled} onChange={(e) => setRuleData({ ...ruleData, enabled: e.target.checked })} />
            <span>Ativo</span>
          </label>
          <Button onClick={handleSaveRule} className="support-button-full">Salvar regra</Button>

          <div style={{ marginTop: '12px', overflowX: 'auto' }}>
            <table className="support-table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Departamento</th>
                  <th>Prioridade</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>Nenhuma regra</td></tr>
                )}
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.keyword}</td>
                    <td>{departments.find((d) => d.id === r.departmentId)?.name || r.departmentId}</td>
                    <td>{r.priority}</td>
                    <td>{r.enabled ? 'Ativo' : 'Inativo'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
