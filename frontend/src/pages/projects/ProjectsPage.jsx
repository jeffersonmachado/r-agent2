import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/authContext';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { CrudPageBase } from '../../modules/crud-base';
import { Button } from '../../styles/Button';
import { createProject, listProjects, listProjectTemplates, createProjectFromTemplate } from '../../api/projects';
import { ProjectFilters } from '../../components/projects/ProjectFilters';

function traduzirStatusProjeto(value) {
  const map = {
    active: 'Ativo',
    paused: 'Pausado',
    done: 'Concluído',
    cancelled: 'Cancelado',
    archived: 'Arquivado',
  };
  const key = String(value || '').toLowerCase();
  return map[key] || value || '-';
}

function traduzirSaudeProjeto(value) {
  const map = {
    healthy: 'Saudável',
    attention: 'Atenção',
    warning: 'Alerta',
    critical: 'Crítico',
    blocked: 'Bloqueado',
  };
  const key = String(value || '').toLowerCase();
  return map[key] || value || '-';
}

export function ProjectsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', priority: 'medium', templateId: '' });

  async function load(nextFilters = filters) {
    setLoading(true);
    try {
      const [projectsResponse, templatesResponse] = await Promise.all([
        listProjects(nextFilters),
        listProjectTemplates(),
      ]);
      setProjects(Array.isArray(projectsResponse?.projects) ? projectsResponse.projects : []);
      setTemplates(Array.isArray(templatesResponse?.templates) ? templatesResponse.templates : []);
    } catch (error) {
      showToast('Erro ao carregar projetos', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) load();
  }, [authLoading, isAuthenticated]);

  async function handleCreate() {
    if (!form.name.trim()) {
      showToast('Informe um nome para o projeto', 'warning');
      return;
    }
    setLoading(true);
    try {
      if (form.templateId) {
        await createProjectFromTemplate({
          templateId: form.templateId,
          name: form.name.trim(),
          description: form.description.trim(),
          priority: form.priority,
        });
      } else {
        await createProject({
          name: form.name.trim(),
          description: form.description.trim(),
          priority: form.priority,
          visibility: 'team',
        });
      }
      setForm({ name: '', description: '', priority: 'medium', templateId: '' });
      setShowModal(false);
      await load();
      showToast('Projeto criado', 'success');
    } catch (error) {
      showToast('Erro ao criar projeto', 'error');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return <CrudPageBase><div style={{ padding: '40px' }}>Carregando...</div></CrudPageBase>;
  }
  if (!isAuthenticated) return null;

  return (
    <CrudPageBase
      actions={(
        <Button onClick={() => setShowModal(true)} style={{ backgroundColor: '#25D366', color: 'white' }}>
          ➕ Novo projeto
        </Button>
      )}
    >
      <ToastContainer />

      <ProjectFilters
        filters={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onClear={() => {
          const next = { q: '', status: '' };
          setFilters(next);
          load(next);
        }}
      />

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => navigate(`/projects/${project.id}`)}
            className="text-left bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg transition hover:border-primary-400 cursor-pointer"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-xs text-text-secondary mb-1">{project.code} • {traduzirStatusProjeto(project.status)}</div>
                <div className="text-lg font-semibold text-text-primary">{project.name}</div>
              </div>
              <div className="text-xs px-2 py-1 rounded-full border border-border-default text-text-secondary">{traduzirSaudeProjeto(project.health)}</div>
            </div>
            <div className="text-sm text-text-secondary mb-4">{project.description || 'Sem descrição.'}</div>
            <div className="grid gap-2 text-sm text-text-secondary">
              <div>Itens: {project?.kpis?.totalItems || 0}</div>
              <div>Concluídos: {project?.kpis?.doneItems || 0}</div>
              <div>Atrasados: {project?.kpis?.overdueItems || 0}</div>
            </div>
          </button>
        ))}
        {projects.length === 0 && !loading ? (
          <div className="bg-bg-elevated rounded-xl border border-dashed border-border-default p-6 text-text-secondary">
            Nenhum projeto encontrado.
          </div>
        ) : null}
      </div>

      {/* Modal Novo Projeto */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-6">Novo projeto</h2>
            <form
              onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
              className="space-y-4"
            >
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Nome *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary transition-all"
                />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary transition-all resize-none"
                />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Modelo</label>
                <select
                  value={form.templateId}
                  onChange={(e) => setForm((prev) => ({ ...prev, templateId: e.target.value }))}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary transition-all cursor-pointer"
                >
                  <option value="">Sem modelo</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Prioridade</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary transition-all cursor-pointer"
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowModal(false)} disabled={loading}>
                  Cancelar
                </Button>
                <Button type="submit" style={{ backgroundColor: '#25D366', color: 'white' }} disabled={loading}>
                  {loading ? 'Criando...' : 'Criar projeto'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </CrudPageBase>
  );
}

export default ProjectsPage;
