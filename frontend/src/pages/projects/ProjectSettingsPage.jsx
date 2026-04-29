import React, { useEffect, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, updateProject, listProjects } from '../../api/projects';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

export function ProjectSettingsPage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const projectId = getProjectIdFromPath(currentPath);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    priority: 'medium',
    status: 'active',
  });

  useEffect(() => {
    async function load() {
      if (!projectId) return;
      setLoading(true);
      try {
        const projectResponse = await getProject(projectId);
        setProject(projectResponse?.project || null);
        if (projectResponse?.project) {
          setForm({
            name: projectResponse.project.name || '',
            description: projectResponse.project.description || '',
            priority: projectResponse.project.priority || 'medium',
            status: projectResponse.project.status || 'active',
          });
        }
      } catch (error) {
        // Fallback automático para ID numérico inválido
        const isNumericId = /^\d+$/.test(String(projectId || ''));
        if (isNumericId || error?.status === 404) {
          try {
            const projectsResponse = await listProjects();
            const firstProject = Array.isArray(projectsResponse?.projects) && projectsResponse.projects[0];
            if (firstProject) {
              navigate(`/projects/${firstProject.id}/settings`);
              showToast('Redirecionando para o primeiro projeto disponível...', 'info');
              return;
            }
          } catch (fallbackError) {
            // Falhou ao carregar lista de projetos também
          }
        }
        showToast('Erro ao carregar projeto', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, showToast, navigate]);

  async function handleSave() {
    if (!form.name.trim()) {
      showToast('Nome do projeto é obrigatório', 'warning');
      return;
    }

    setSaving(true);
    try {
      await updateProject(projectId, {
        name: form.name.trim(),
        description: form.description.trim(),
        priority: form.priority,
        status: form.status,
      });
      showToast('Projeto atualizado com sucesso', 'success');
      // Recarregar dados
      const projectResponse = await getProject(projectId);
      setProject(projectResponse?.project || null);
    } catch (error) {
      showToast('Erro ao salvar projeto', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <CrudPageBase>
        <div className="flex justify-center py-12">
          <div className="text-text-secondary">Carregando...</div>
        </div>
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>Configurações do Projeto</h1>
      </div>

      <div className="grid gap-6 max-w-2xl">
        {/* Informações básicas */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Informações Básicas</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Nome do Projeto *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: Lançamento RAP — 1/6/2026"
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Descrição
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Descreva o propósito do projeto..."
                rows={4}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary resize-none"
              />
            </div>
          </div>
        </div>

        {/* Configurações */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Configurações</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Prioridade
              </label>
              <select
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary cursor-pointer"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary cursor-pointer"
              >
                <option value="planning">Planejamento</option>
                <option value="active">Ativo</option>
                <option value="on_hold">Suspenso</option>
                <option value="completed">Concluído</option>
                <option value="archived">Arquivado</option>
              </select>
            </div>
          </div>
        </div>

        {/* Botões de ação */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            className="support-button bg-bg-secondary text-text-primary border border-border-default hover:border-border-active cursor-pointer disabled:cursor-not-allowed"
            onClick={() => {
              if (project) {
                setForm({
                  name: project.name || '',
                  description: project.description || '',
                  priority: project.priority || 'medium',
                  status: project.status || 'active',
                });
              }
            }}
            disabled={saving}
          >
            Descartar
          </button>
          <button
            type="button"
            className="support-button cursor-pointer disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </div>
    </CrudPageBase>
  );
}
