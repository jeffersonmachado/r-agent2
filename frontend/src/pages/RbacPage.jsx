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
import { listAgents } from '../api/auth';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

// ---------------------------------------------------------------------------
// Metadados de roles
// ---------------------------------------------------------------------------
const ROLE_META = {
  owner:      { label: 'Proprietário',     color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.3)'  },
  admin:      { label: 'Administrador',    color: '#ef4444', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.3)'   },
  manager:    { label: 'Gerente',          color: '#f97316', bg: 'rgba(249,115,22,0.10)',  border: 'rgba(249,115,22,0.3)'  },
  supervisor: { label: 'Supervisor',       color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.3)'  },
  operator:   { label: 'Operador',         color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)'  },
  agent:      { label: 'Agente',           color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)'  },
  auditor:    { label: 'Auditor',          color: '#14b8a6', bg: 'rgba(20,184,166,0.10)', border: 'rgba(20,184,166,0.3)'  },
  readonly:   { label: 'Somente Leitura',  color: '#6b7280', bg: 'rgba(107,114,128,0.10)',border: 'rgba(107,114,128,0.3)' },
};

const RESOURCE_LABELS = {
  tickets:       'Tickets',
  queues:        'Filas',
  agents:        'Agentes',
  config:        'Configurações',
  flows:         'Fluxos',
  reports:       'Relatórios',
  analytics:     'Analytics',
  audit:         'Auditoria',
  quick_replies: 'Respostas Rápidas',
  departments:   'Departamentos',
  bulk_messaging:'Disparos em Massa',
  rag:           'RAG / IA',
  rpa:           'RPA',
  ai:            'IA',
  projects:      'Projetos',
  workspace:     'Workspace',
  tenant:        'Tenant',
  crm:           'CRM',
  billing:       'Faturamento',
};

const ACTION_LABELS = {
  read:       'Ler',
  create:     'Criar',
  update:     'Editar',
  delete:     'Excluir',
  list_all:   'Listar Tudo',
  assign:     'Atribuir',
  close:      'Fechar',
  execute:    'Executar',
  export:     'Exportar',
  admin:      'Admin',
  manage:     'Gerenciar',
  billing:    'Faturamento',
  invite:     'Convidar',
  train:      'Treinar',
  configure:  'Configurar',
  query:      'Consultar',
  index:      'Indexar',
};

function roleMeta(role) {
  return ROLE_META[role] || { label: role, color: '#6b7280', bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.3)' };
}

function resourceLabel(r) { return RESOURCE_LABELS[r] || r; }
function actionLabel(a)   { return ACTION_LABELS[a] || a; }

function groupByResource(perms) {
  const map = {};
  for (const p of (perms || [])) {
    if (!map[p.resource]) map[p.resource] = new Set();
    map[p.resource].add(p.action);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Componentes pequenos
// ---------------------------------------------------------------------------
function RoleBadge({ role, size = 'sm' }) {
  const m = roleMeta(role);
  return (
    <span style={{
      padding: size === 'sm' ? '2px 10px' : '4px 14px',
      borderRadius: 999,
      fontSize: size === 'sm' ? '0.72rem' : '0.83rem',
      fontWeight: 600,
      color: m.color,
      background: m.bg,
      border: `1px solid ${m.border}`,
      whiteSpace: 'nowrap',
      letterSpacing: '0.01em',
    }}>
      {m.label}
    </span>
  );
}

function PermChip({ label }) {
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 6,
      fontSize: '0.72rem',
      background: 'var(--color-bg-primary)',
      border: '1px solid var(--color-border-default)',
      color: 'var(--color-text-secondary)',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>
      {children}
    </h3>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--color-border-default)', marginBottom: '1.5rem' }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: '0.6rem 1.2rem',
            border: 'none',
            borderBottom: active === t.id ? '2px solid var(--color-accent-primary, #6366f1)' : '2px solid transparent',
            background: 'none',
            color: active === t.id ? 'var(--color-accent-primary, #6366f1)' : 'var(--color-text-secondary)',
            fontWeight: active === t.id ? 700 : 400,
            cursor: 'pointer',
            fontSize: '0.9rem',
            marginBottom: -1,
            transition: 'color 0.15s',
          }}
        >
          {t.label}
          {t.count != null && (
            <span style={{ marginLeft: '0.4rem', padding: '1px 6px', borderRadius: 99, background: 'var(--color-bg-primary)', fontSize: '0.7rem', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 1 — Usuários
// ---------------------------------------------------------------------------
function TabUsuarios({ agents, roles, loading, onAssign }) {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [selected, setSelected] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [assigning, setAssigning] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return agents.filter((a) => {
      const matchQ = !q || (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q);
      const matchRole = !filterRole || a.role === filterRole;
      return matchQ && matchRole;
    });
  }, [agents, search, filterRole]);

  function handleSelect(agent) {
    setSelected(agent);
    setNewRole(agent.role || '');
  }

  async function handleAssign() {
    if (!selected || !newRole) return;
    setAssigning(true);
    try {
      await onAssign(selected.id, newRole);
      setSelected(prev => prev ? { ...prev, role: newRole } : prev);
    } finally {
      setAssigning(false);
    }
  }

  const roleOptions = useMemo(() => Array.from(new Set(roles.map(r => r.role))), [roles]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 360px' : '1fr', gap: '1.25rem' }}>
      {/* Lista de agentes */}
      <div>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            className="support-form-input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="support-form-select"
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            style={{ minWidth: 160 }}
          >
            <option value="">Todos os roles</option>
            {roleOptions.map(r => (
              <option key={r} value={r}>{roleMeta(r).label}</option>
            ))}
          </select>
          {(search || filterRole) && (
            <Button variant="secondary" onClick={() => { setSearch(''); setFilterRole(''); }}>Limpar</Button>
          )}
        </div>

        {loading ? (
          <p className="text-text-secondary text-sm">Carregando agentes...</p>
        ) : (
          <>
            <p className="text-text-secondary text-sm" style={{ marginBottom: '0.75rem' }}>
              {filtered.length} {filtered.length === 1 ? 'agente' : 'agentes'}
              {search || filterRole ? ' encontrados' : ' no total'}
            </p>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {filtered.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleSelect(agent)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    borderRadius: 10,
                    border: selected?.id === agent.id
                      ? '1px solid var(--color-accent-primary, #6366f1)'
                      : '1px solid var(--color-border-default)',
                    background: selected?.id === agent.id
                      ? 'var(--color-bg-elevated)'
                      : 'var(--color-bg-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: roleMeta(agent.role).bg,
                    border: `2px solid ${roleMeta(agent.role).border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1rem', fontWeight: 700,
                    color: roleMeta(agent.role).color,
                    flexShrink: 0,
                  }}>
                    {(agent.name || agent.email || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agent.name || agent.email}
                    </div>
                    {agent.name && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.email}
                      </div>
                    )}
                  </div>
                  <RoleBadge role={agent.role || 'operator'} />
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-text-secondary text-sm" style={{ textAlign: 'center', padding: '2rem' }}>
                  Nenhum agente encontrado.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Painel lateral de atribuição */}
      {selected && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-primary)' }}>{selected.name || selected.email}</div>
              {selected.name && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>{selected.email}</div>}
            </div>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: '1.1rem', padding: '0 0.25rem' }}
            >
              ×
            </button>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <SectionTitle>Role atual</SectionTitle>
            <RoleBadge role={selected.role || 'operator'} size="md" />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <SectionTitle>Novo role</SectionTitle>
            <select
              className="support-form-select"
              style={{ width: '100%', marginBottom: '0.5rem' }}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="">Selecione um role...</option>
              {roles.map((r) => (
                <option key={r.role} value={r.role}>{roleMeta(r.role).label} ({r.role})</option>
              ))}
            </select>
            {newRole && (
              <div style={{ padding: '0.6rem 0.75rem', borderRadius: 8, background: roleMeta(newRole).bg, border: `1px solid ${roleMeta(newRole).border}`, fontSize: '0.8rem', color: roleMeta(newRole).color }}>
                {roleMeta(newRole).label}
                {roles.find(r => r.role === newRole)?.permissions?.length != null && (
                  <span style={{ opacity: 0.8 }}> · {roles.find(r => r.role === newRole).permissions.length} permissões</span>
                )}
              </div>
            )}
          </div>

          <Button
            onClick={handleAssign}
            disabled={assigning || !newRole || newRole === selected.role}
            style={{ width: '100%' }}
          >
            {assigning ? 'Aplicando...' : newRole === selected.role ? 'Role inalterado' : 'Aplicar role'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 2 — Roles
// ---------------------------------------------------------------------------
function TabRoles({ roles, allPermissions, loading, onCreate }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [selectedPerms, setSelectedPerms] = useState(new Set());
  const [creating, setCreating] = useState(false);

  const permsByResource = useMemo(() => groupByResource(allPermissions), [allPermissions]);
  const resources = useMemo(() => Object.keys(permsByResource).sort(), [permsByResource]);

  function togglePerm(resource, action) {
    const key = `${resource}:${action}`;
    setSelectedPerms(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleResource(resource, actions) {
    const allSelected = [...actions].every(a => selectedPerms.has(`${resource}:${a}`));
    setSelectedPerms(prev => {
      const next = new Set(prev);
      for (const a of actions) {
        if (allSelected) next.delete(`${resource}:${a}`);
        else next.add(`${resource}:${a}`);
      }
      return next;
    });
  }

  async function handleCreate() {
    const name = newRoleName.trim().toLowerCase();
    if (!name) return;
    const permissions = [...selectedPerms].map(key => {
      const [resource, action] = key.split(':');
      return { resource, action };
    });
    setCreating(true);
    try {
      await onCreate(name, permissions);
      setNewRoleName('');
      setSelectedPerms(new Set());
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="text-text-secondary text-sm">Carregando roles...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <p className="text-text-secondary text-sm">{roles.length} role{roles.length !== 1 ? 's' : ''} configurado{roles.length !== 1 ? 's' : ''}</p>
        <Button onClick={() => setShowCreate(v => !v)}>
          {showCreate ? 'Cancelar' : '+ Criar role'}
        </Button>
      </div>

      {/* Formulário de criação */}
      {showCreate && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mb-6">
          <SectionTitle>Novo role</SectionTitle>
          <input
            className="support-form-input"
            style={{ marginBottom: '1.25rem' }}
            placeholder="Nome do role (ex: revisor, moderador...)"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
          />
          <SectionTitle>Permissões ({selectedPerms.size} selecionadas)</SectionTitle>
          <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
            {resources.map((res) => {
              const actions = [...permsByResource[res]].sort();
              const allSelected = actions.every(a => selectedPerms.has(`${res}:${a}`));
              const someSelected = actions.some(a => selectedPerms.has(`${res}:${a}`));
              return (
                <div key={res} style={{ borderRadius: 8, border: '1px solid var(--color-border-default)', overflow: 'hidden' }}>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.5rem 0.75rem',
                    background: someSelected ? 'var(--color-bg-elevated)' : 'var(--color-bg-primary)',
                    cursor: 'pointer', userSelect: 'none',
                    borderBottom: '1px solid var(--color-border-default)',
                  }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={() => toggleResource(res, actions)}
                    />
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>
                      {resourceLabel(res)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{res}</span>
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', padding: '0.5rem 0.75rem' }}>
                    {actions.map((action) => {
                      const key = `${res}:${action}`;
                      const checked = selectedPerms.has(key);
                      return (
                        <label key={action} style={{
                          display: 'flex', alignItems: 'center', gap: '0.3rem',
                          padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                          fontSize: '0.78rem',
                          background: checked ? 'rgba(99,102,241,0.10)' : 'transparent',
                          border: checked ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                          color: checked ? 'var(--color-accent-primary, #6366f1)' : 'var(--color-text-secondary)',
                        }}>
                          <input type="checkbox" checked={checked} onChange={() => togglePerm(res, action)} style={{ display: 'none' }} />
                          {actionLabel(action)}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <Button onClick={handleCreate} disabled={creating || !newRoleName.trim()}>
            {creating ? 'Criando...' : 'Criar role'}
          </Button>
        </div>
      )}

      {/* Cards dos roles existentes */}
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {roles.map((r) => {
          const meta = roleMeta(r.role);
          const byRes = groupByResource(r.permissions || []);
          const resKeys = Object.keys(byRes).sort();
          return (
            <div key={r.role} style={{
              borderRadius: 12, border: `1px solid ${meta.border}`,
              background: 'var(--color-bg-elevated)', overflow: 'hidden',
            }}>
              <div style={{ padding: '0.85rem 1rem', background: meta.bg, display: 'flex', alignItems: 'center', gap: '0.6rem', borderBottom: `1px solid ${meta.border}` }}>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: meta.color }}>{meta.label}</span>
                <span style={{ fontSize: '0.75rem', color: meta.color, opacity: 0.7 }}>({r.role})</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: meta.color, opacity: 0.8 }}>
                  {(r.permissions || []).length} permissões
                </span>
              </div>
              <div style={{ padding: '0.75rem 1rem', display: 'grid', gap: '0.6rem', maxHeight: 260, overflowY: 'auto' }}>
                {resKeys.length === 0 && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>Nenhuma permissão definida</span>
                )}
                {resKeys.map((res) => (
                  <div key={res}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: '0.3rem' }}>
                      {resourceLabel(res)}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {[...byRes[res]].sort().map(a => <PermChip key={a} label={actionLabel(a)} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 3 — Matriz de permissões
// ---------------------------------------------------------------------------
function TabMatriz({ roles, allPermissions }) {
  const resources = useMemo(() => {
    const s = new Set(allPermissions.map(p => p.resource));
    return [...s].sort();
  }, [allPermissions]);

  const allActions = useMemo(() => {
    const s = new Set(allPermissions.map(p => p.action));
    return [...s].sort();
  }, [allPermissions]);

  const roleNames = useMemo(() => roles.map(r => r.role), [roles]);

  // roleHasPermission[role][resource:action] = bool
  const rolePerms = useMemo(() => {
    const map = {};
    for (const r of roles) {
      map[r.role] = new Set((r.permissions || []).map(p => `${p.resource}:${p.action}`));
    }
    return map;
  }, [roles]);

  if (roles.length === 0) {
    return <p className="text-text-secondary text-sm">Nenhum role disponível.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: '0.78rem' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left', minWidth: 120 }}>Recurso</th>
            <th style={{ ...thStyle, textAlign: 'left', minWidth: 90 }}>Ação</th>
            {roleNames.map(r => {
              const m = roleMeta(r);
              return (
                <th key={r} style={{ ...thStyle, minWidth: 90 }}>
                  <span style={{ color: m.color, fontWeight: 700 }}>{m.label}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {resources.flatMap((res, ri) => {
            const actions = [...new Set(allPermissions.filter(p => p.resource === res).map(p => p.action))].sort();
            return actions.map((action, ai) => {
              const key = `${res}:${action}`;
              const isFirst = ai === 0;
              return (
                <tr key={key} style={{ background: ri % 2 === 0 ? 'var(--color-bg-primary)' : 'var(--color-bg-elevated)' }}>
                  <td style={{ ...tdStyle, fontWeight: isFirst ? 600 : 400, color: isFirst ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', paddingTop: isFirst ? '0.6rem' : '0.3rem', borderTop: isFirst && ri > 0 ? '1px solid var(--color-border-default)' : 'none' }}>
                    {isFirst ? resourceLabel(res) : ''}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{actionLabel(action)}</td>
                  {roleNames.map(r => {
                    const has = rolePerms[r]?.has(key);
                    return (
                      <td key={r} style={{ ...tdStyle, textAlign: 'center' }}>
                        {has ? (
                          <span style={{ color: roleMeta(r).color, fontSize: '1rem', fontWeight: 700 }}>✓</span>
                        ) : (
                          <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = {
  padding: '0.5rem 0.75rem',
  borderBottom: '2px solid var(--color-border-default)',
  fontWeight: 700,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-text-secondary)',
  background: 'var(--color-bg-elevated)',
  textAlign: 'center',
};

const tdStyle = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--color-border-default)',
  verticalAlign: 'middle',
};

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export function RbacPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [tab, setTab] = useState('usuarios');
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [authLoading, isAuthenticated, navigate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesResp, permsResp, agentsResp] = await Promise.all([
        getRbacRoles(),
        getRbacPermissions(),
        listAgents(),
      ]);
      setRoles(Array.isArray(rolesResp?.roles) ? rolesResp.roles : []);
      setPermissions(Array.isArray(permsResp?.permissions) ? permsResp.permissions : []);
      setAgents(Array.isArray(agentsResp?.agents) ? agentsResp.agents : []);
    } catch (err) {
      logger.error('[RBAC] Erro ao carregar dados', err);
      showToast('Erro ao carregar dados de permissões', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) loadData();
  }, [authLoading, isAuthenticated, loadData]);

  async function handleAssign(agentId, role) {
    try {
      await assignRbacRole({ agentId, role });
      showToast(`Role "${roleMeta(role).label}" aplicado com sucesso`, 'success');
      // Atualiza o role do agente localmente
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, role } : a));
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao atribuir role';
      showToast(msg, 'error');
      throw err;
    }
  }

  async function handleCreateRole(name, perms) {
    try {
      await createRbacRole({ role: name, permissions: perms });
      showToast(`Role "${name}" criado com sucesso`, 'success');
      await loadData();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao criar role';
      showToast(msg, 'error');
      throw err;
    }
  }

  if (authLoading) {
    return (
      <CrudPageBase>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) return null;

  const TABS = [
    { id: 'usuarios', label: 'Usuários', count: agents.length },
    { id: 'roles', label: 'Roles', count: roles.length },
    { id: 'matriz', label: 'Matriz de Permissões' },
  ];

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1 style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--color-text-primary)' }}>
          Permissões e Acesso
        </h1>
        <div className="support-controls">
          <Button onClick={loadData} disabled={loading}>
            {loading ? 'Atualizando...' : 'Atualizar'}
          </Button>
        </div>
      </div>

      {/* Resumo por role */}
      {!loading && agents.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {Object.entries(
            agents.reduce((acc, a) => {
              const r = a.role || 'operator';
              acc[r] = (acc[r] || 0) + 1;
              return acc;
            }, {})
          )
            .sort((a, b) => b[1] - a[1])
            .map(([role, count]) => {
              const m = roleMeta(role);
              return (
                <div key={role} style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '4px 12px', borderRadius: 999,
                  background: m.bg, border: `1px solid ${m.border}`,
                  fontSize: '0.8rem',
                }}>
                  <span style={{ fontWeight: 700, color: m.color }}>{count}</span>
                  <span style={{ color: m.color }}>{m.label}</span>
                </div>
              );
            })}
        </div>
      )}

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'usuarios' && (
        <TabUsuarios
          agents={agents}
          roles={roles}
          loading={loading}
          onAssign={handleAssign}
        />
      )}
      {tab === 'roles' && (
        <TabRoles
          roles={roles}
          allPermissions={permissions}
          loading={loading}
          onCreate={handleCreateRole}
        />
      )}
      {tab === 'matriz' && (
        <TabMatriz
          roles={roles}
          allPermissions={permissions}
        />
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}
