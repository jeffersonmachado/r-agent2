import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import {
  getRbacRoles,
  getRbacPermissions,
  createRbacRole,
  assignRbacRole,
} from '../api/rbac';
import logger from '../utils/logger';

export function RbacPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(false);

  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState('');
  const [assignAgentId, setAssignAgentId] = useState('');
  const [assignRole, setAssignRole] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesResp, permsResp] = await Promise.all([
        getRbacRoles(),
        getRbacPermissions(),
      ]);
      setRoles(Array.isArray(rolesResp?.roles) ? rolesResp.roles : []);
      setPermissions(Array.isArray(permsResp?.permissions) ? permsResp.permissions : []);
    } catch (err) {
      logger.error('[RBAC] Erro ao carregar dados', err);
      showToast('Erro ao carregar RBAC', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadData();
    }
  }, [authLoading, isAuthenticated, loadData]);

  const permissionsList = useMemo(() => permissions || [], [permissions]);

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    if (!name) {
      showToast('Informe o nome do role', 'warning');
      return;
    }

    const perms = newRolePermissions
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [resource, action] = line.split(':').map((p) => p.trim());
        return resource && action ? { resource, action } : null;
      })
      .filter(Boolean);

    try {
      await createRbacRole({ role: name, permissions: perms });
      showToast('Role criado com sucesso', 'success');
      setNewRoleName('');
      setNewRolePermissions('');
      await loadData();
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao criar role';
      showToast(message, 'error');
    }
  };

  const handleAssignRole = async () => {
    if (!assignAgentId.trim() || !assignRole.trim()) {
      showToast('Informe agentId e role', 'warning');
      return;
    }

    try {
      await assignRbacRole({ agentId: assignAgentId.trim(), role: assignRole.trim() });
      showToast('Role atribuído com sucesso', 'success');
      setAssignAgentId('');
      await loadData();
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao atribuir role';
      showToast(message, 'error');
    }
  };

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
      <div className="support-header">
        <h1>🔐 RBAC</h1>
        <div className="support-controls" style={{ flexWrap: 'wrap' }}>
          <Button onClick={loadData} disabled={loading} className="support-button">Atualizar</Button>
        </div>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr', gap: '16px' }}>
        <div className="support-details-panel">
          <div className="support-details-title">Atribuir role</div>
          <div className="support-form-group">
            <label className="support-form-label">Agent ID</label>
            <input
              className="support-form-input"
              value={assignAgentId}
              onChange={(e) => setAssignAgentId(e.target.value)}
              placeholder="ID do agente"
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Role</label>
            <select
              className="support-form-select"
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
            >
              <option value="">Selecione</option>
              {roles.map((r) => (
                <option key={r.role} value={r.role}>{r.role}</option>
              ))}
            </select>
          </div>
          <Button onClick={handleAssignRole} className="support-button-full">Atribuir</Button>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Criar role</div>
          <div className="support-form-group">
            <label className="support-form-label">Nome</label>
            <input
              className="support-form-input"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="ex: reviewer"
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Permissões (uma por linha: recurso:acao)</label>
            <textarea
              className="support-form-textarea"
              value={newRolePermissions}
              onChange={(e) => setNewRolePermissions(e.target.value)}
              rows={5}
              placeholder="tickets:read\nqueues:read"
            />
          </div>
          <Button onClick={handleCreateRole} className="support-button-full">Criar</Button>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Roles existentes</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="support-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Permissões</th>
                </tr>
              </thead>
              <tbody>
                {roles.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                      Nenhum role
                    </td>
                  </tr>
                )}
                {roles.map((r) => (
                  <tr key={r.role}>
                    <td>{r.role}</td>
                    <td>{Array.isArray(r.permissions) ? r.permissions.map((p) => `${p.resource}:${p.action}`).join(', ') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Permissões disponíveis</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="support-table">
              <thead>
                <tr>
                  <th>Recurso</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {permissionsList.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                      Nenhuma permissão
                    </td>
                  </tr>
                )}
                {permissionsList.map((p) => (
                  <tr key={`${p.resource}:${p.action}`}>
                    <td>{p.resource}</td>
                    <td>{p.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
