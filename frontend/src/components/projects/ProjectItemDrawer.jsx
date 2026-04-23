import React, { useEffect, useState } from 'react';
import { createProjectComment, getProjectItem, updateProjectItem } from '../../api/projects';

export function ProjectItemDrawer({ projectId, item, onClose, onSaved, showToast }) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(item);
  const [commentBody, setCommentBody] = useState('');
  const [form, setForm] = useState({
    title: item?.title || '',
    description: item?.description || '',
    priority: item?.priority || 'medium',
    dueDate: item?.due_date ? String(item.due_date).slice(0, 16) : '',
  });

  useEffect(() => {
    let active = true;
    async function load() {
      if (!projectId || !item?.id) return;
      setLoading(true);
      try {
        const response = await getProjectItem(projectId, item.id);
        if (active) {
          const nextItem = response?.item || item;
          setDetails(nextItem);
          setForm({
            title: nextItem?.title || '',
            description: nextItem?.description || '',
            priority: nextItem?.priority || 'medium',
            dueDate: nextItem?.due_date ? String(nextItem.due_date).slice(0, 16) : '',
          });
        }
      } catch (error) {
        if (active) showToast?.('Erro ao carregar detalhes do item', 'error');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [item?.id, projectId, showToast]);

  if (!item) return null;

  async function handleSave() {
    setLoading(true);
    try {
      await updateProjectItem(projectId, item.id, {
        title: form.title,
        description: form.description,
        priority: form.priority,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      showToast?.('Item atualizado', 'success');
      onSaved?.();
    } catch (error) {
      showToast?.('Erro ao atualizar item', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleComment() {
    if (!commentBody.trim()) return;
    setLoading(true);
    try {
      await createProjectComment(projectId, item.id, { body: commentBody.trim() });
      setCommentBody('');
      showToast?.('Comentario adicionado', 'success');
      onSaved?.();
    } catch (error) {
      showToast?.('Erro ao adicionar comentario', 'error');
    } finally {
      setLoading(false);
    }
  }

  const comments = Array.isArray(details?.comments) ? details.comments : [];
  const activities = Array.isArray(details?.activities) ? details.activities : [];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 50,
      }}
    >
      <div className="bg-bg-elevated border-l border-border-default shadow-2xl" style={{ width: 'min(520px, 100vw)', height: '100%', overflowY: 'auto', padding: '24px' }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-text-secondary mb-1">{details?.item_type || 'task'} • {details?.status || 'todo'}</div>
            <h2 className="text-xl font-semibold text-text-primary">{details?.title}</h2>
          </div>
          <button type="button" className="support-button" onClick={onClose}>Fechar</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="support-form-label">Titulo</label>
            <input className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
          </div>
          <div>
            <label className="support-form-label">Descricao</label>
            <textarea className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary min-h-[120px]" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label className="support-form-label">Prioridade</label>
              <select className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}>
                <option value="low">Baixa</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="critical">Critica</option>
              </select>
            </div>
            <div>
              <label className="support-form-label">Prazo</label>
              <input type="datetime-local" className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </div>
          </div>
          <button type="button" className="support-button" onClick={handleSave} disabled={loading}>Salvar item</button>

          <div className="pt-4 border-t border-border-default">
            <div className="text-lg font-semibold text-text-primary mb-2">Comentarios</div>
            <textarea className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary min-h-[96px]" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Adicionar contexto, evidencia ou proximo passo" />
            <button type="button" className="support-button mt-2" onClick={handleComment} disabled={loading}>Comentar</button>
            <div className="mt-4 space-y-3">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-xl border border-border-default bg-bg-secondary p-3">
                  <div className="text-xs text-text-secondary mb-1">{comment.author?.name || comment.author_user_id || 'Sistema'}</div>
                  <div className="text-sm text-text-primary">{comment.body}</div>
                </div>
              ))}
              {comments.length === 0 ? <div className="text-sm text-text-secondary">Nenhum comentario ainda.</div> : null}
            </div>
          </div>

          <div className="pt-4 border-t border-border-default">
            <div className="text-lg font-semibold text-text-primary mb-2">Historico</div>
            <div className="space-y-3">
              {activities.map((activity) => (
                <div key={activity.id} className="rounded-xl border border-border-default bg-bg-secondary p-3">
                  <div className="text-xs text-text-secondary mb-1">{activity.event_type}</div>
                  <div className="text-xs text-text-secondary">{activity.created_at ? new Date(activity.created_at).toLocaleString('pt-BR') : '-'}</div>
                </div>
              ))}
              {activities.length === 0 ? <div className="text-sm text-text-secondary">Sem eventos registrados.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectItemDrawer;
