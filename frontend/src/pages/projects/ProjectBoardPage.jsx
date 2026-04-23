import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useRouter } from '../../hooks/useRouter';
import { CrudPageBase } from '../../modules/crud-base';
import { createProjectItem, getProject, getProjectDashboard, listProjectItems, listProjectLists, moveProjectItem } from '../../api/projects';
import { ProjectBoardColumn } from '../../components/projects/ProjectBoardColumn';
import { ProjectItemDrawer } from '../../components/projects/ProjectItemDrawer';
import { ProjectKpis } from '../../components/projects/ProjectKpis';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

export function ProjectBoardPage() {
  const { currentPath, navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const projectId = getProjectIdFromPath(currentPath);
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState(null);
  const [lists, setLists] = useState([]);
  const [items, setItems] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [newItem, setNewItem] = useState({ title: '', itemType: 'task', priority: 'medium', listId: '' });

  async function load() {
    if (!projectId) return;
    setLoading(true);
    try {
      const [projectResponse, listsResponse, itemsResponse, dashboardResponse] = await Promise.all([
        getProject(projectId),
        listProjectLists(projectId),
        listProjectItems(projectId),
        getProjectDashboard(projectId),
      ]);
      setProject(projectResponse?.project || null);
      setLists(Array.isArray(listsResponse?.lists) ? listsResponse.lists : []);
      setItems(Array.isArray(itemsResponse?.items) ? itemsResponse.items : []);
      setDashboard(dashboardResponse?.dashboard || null);
    } catch (error) {
      showToast('Erro ao carregar quadro do projeto', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  const itemsByList = useMemo(() => {
    const grouped = {};
    for (const list of lists) grouped[list.id] = [];
    for (const item of items) {
      if (!grouped[item.list_id]) grouped[item.list_id] = [];
      grouped[item.list_id].push(item);
    }
    return grouped;
  }, [items, lists]);

  async function handleCreateItem() {
    if (!newItem.title.trim()) {
      showToast('Informe um titulo para o item', 'warning');
      return;
    }
    setLoading(true);
    try {
      await createProjectItem(projectId, {
        title: newItem.title.trim(),
        itemType: newItem.itemType,
        priority: newItem.priority,
        listId: newItem.listId || lists[0]?.id || null,
      });
      setNewItem({ title: '', itemType: 'task', priority: 'medium', listId: '' });
      await load();
      showToast('Item criado', 'success');
    } catch (error) {
      showToast('Erro ao criar item', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDropItem(itemId, listId) {
    if (!projectId || !itemId || !listId) return;
    try {
      await moveProjectItem(projectId, itemId, { listId, position: 0 });
      await load();
    } catch (error) {
      showToast('Erro ao mover item', 'error');
    }
  }

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Quadro do Projeto'}</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <button type="button" className="support-button" onClick={() => navigate('/projects')}>Projetos</button>
          <button type="button" className="support-button" onClick={() => navigate(`/projects/${projectId}/list`)}>Lista</button>
          <button type="button" className="support-button" onClick={() => navigate(`/projects/${projectId}/dashboard`)}>Painel</button>
          <button type="button" className="support-button" onClick={() => navigate(`/projects/${projectId}/timeline`)}>Linha do Tempo</button>
        </div>
      </div>

      <ProjectKpis dashboard={dashboard} />

      <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg mb-6">
        <div className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
          <input className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" placeholder="Novo item" value={newItem.title} onChange={(event) => setNewItem((prev) => ({ ...prev, title: event.target.value }))} />
          <select className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={newItem.itemType} onChange={(event) => setNewItem((prev) => ({ ...prev, itemType: event.target.value }))}>
            <option value="epic">Epic</option>
            <option value="story">Historia</option>
            <option value="task">Tarefa</option>
            <option value="bug">Bug</option>
            <option value="incident">Incidente</option>
            <option value="improvement">Melhoria</option>
            <option value="deployment">Implantacao</option>
            <option value="qa_fix">Correcao QA</option>
            <option value="automation">Automacao</option>
            <option value="research">Pesquisa</option>
          </select>
          <select className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={newItem.priority} onChange={(event) => setNewItem((prev) => ({ ...prev, priority: event.target.value }))}>
            <option value="low">Baixa</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
            <option value="critical">Critica</option>
          </select>
          <select className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={newItem.listId} onChange={(event) => setNewItem((prev) => ({ ...prev, listId: event.target.value }))}>
            <option value="">Primeira coluna</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
          <button type="button" className="support-button" onClick={handleCreateItem} disabled={loading}>Criar</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
        {lists.map((list) => (
          <ProjectBoardColumn
            key={list.id}
            list={list}
            items={itemsByList[list.id] || []}
            onDropItem={handleDropItem}
            onOpenItem={setSelectedItem}
          />
        ))}
      </div>

      {selectedItem ? (
        <ProjectItemDrawer
          projectId={projectId}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onSaved={async () => {
            await load();
            const reloaded = items.find((entry) => entry.id === selectedItem.id) || selectedItem;
            setSelectedItem(reloaded);
          }}
          showToast={showToast}
        />
      ) : null}
    </CrudPageBase>
  );
}

export default ProjectBoardPage;
