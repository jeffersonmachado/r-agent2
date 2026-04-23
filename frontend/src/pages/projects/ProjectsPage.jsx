import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/authContext';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { CrudPageBase } from '../../modules/crud-base';
import { createProject, listProjects, listProjectTemplates, createProjectFromTemplate } from '../../api/projects';
import { ProjectFilters } from '../../components/projects/ProjectFilters';

export function ProjectsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '' });
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
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>Projetos</h1>
        <div className="support-controls">
          <button type="button" className="support-button" onClick={() => load()} disabled={loading}>Atualizar</button>
        </div>
      </div>

      <ProjectFilters
        filters={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onClear={() => {
          const next = { q: '', status: '' };
          setFilters(next);
          load(next);
        }}
      />

      <div className="grid gap-6 mb-6" style={{ gridTemplateColumns: 'minmax(320px, 420px) 1fr' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="text-lg font-semibold text-text-primary mb-4">Novo projeto</div>
          <div className="space-y-4">
            <div>
              <label className="support-form-label">Nome</label>
              <input className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            </div>
            <div>
              <label className="support-form-label">Descricao</label>
              <textarea className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary min-h-[96px]" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </div>
            <div>
              <label className="support-form-label">Template</label>
              <select className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={form.templateId} onChange={(event) => setForm((prev) => ({ ...prev, templateId: event.target.value }))}>
                <option value="">Sem template</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </div>
            <div>
              <label className="support-form-label">Prioridade</label>
              <select className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}>
                <option value="low">Baixa</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="critical">Critica</option>
              </select>
            </div>
            <button type="button" className="support-button" onClick={handleCreate} disabled={loading}>Criar projeto</button>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => navigate(`/projects/${project.id}`)}
              className="text-left bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg transition hover:border-primary-400"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="text-xs text-text-secondary mb-1">{project.code} • {project.status}</div>
                  <div className="text-lg font-semibold text-text-primary">{project.name}</div>
                </div>
                <div className="text-xs px-2 py-1 rounded-full border border-border-default text-text-secondary">{project.health}</div>
              </div>
              <div className="text-sm text-text-secondary mb-4">{project.description || 'Sem descricao.'}</div>
              <div className="grid gap-2 text-sm text-text-secondary">
                <div>Itens: {project?.kpis?.totalItems || 0}</div>
                <div>Concluidos: {project?.kpis?.doneItems || 0}</div>
                <div>Atrasados: {project?.kpis?.overdueItems || 0}</div>
              </div>
            </button>
          ))}
          {projects.length === 0 ? (
            <div className="bg-bg-elevated rounded-xl border border-dashed border-border-default p-6 text-text-secondary">
              Nenhum projeto encontrado.
            </div>
          ) : null}
        </div>
      </div>
    </CrudPageBase>
  );
}

export default ProjectsPage;
