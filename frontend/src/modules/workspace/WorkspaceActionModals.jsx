import React, { useEffect, useState } from 'react';
import { CrmModal } from '../../components/crm/CrmComponents';
import { listResources } from '../../api/workspace';

function Field({ label, required = false, children }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="workspace-muted">{label}{required ? ' *' : ''}</span>
      {children}
    </label>
  );
}

function ModalError({ message }) {
  if (!message) return null;
  return <p className="workspace-pill critical" role="alert">{message}</p>;
}

function ModalFooter({ submitting, onClose }) {
  return (
    <div className="flex justify-end gap-2 mt-1">
      <button type="button" className="workspace-secondary-button" onClick={onClose}>Cancelar</button>
      <button type="submit" className="workspace-action-button" disabled={submitting}>
        {submitting ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  );
}

export function TaskActionModal({ isOpen, taskType = 'task', prefillTitle = '', submitting = false, onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle(prefillTitle || '');
      setDueDate('');
      setDescription('');
      setError('');
    }
  }, [isOpen, prefillTitle]);

  const isFollowUp = taskType === 'followup';

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Informe um título.');
      return;
    }
    onSubmit({ title: title.trim(), description: description.trim(), dueDate, taskType });
  };

  return (
    <CrmModal isOpen={isOpen} onClose={onClose} title={isFollowUp ? 'Criar follow-up' : 'Criar tarefa'}>
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <Field label="Título" required>
          <input
            className="workspace-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={isFollowUp ? 'Ex.: Retornar contato com o cliente' : 'Ex.: Revisar contrato'}
          />
        </Field>
        <Field label="Vencimento">
          <input
            className="workspace-input"
            type="datetime-local"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
        <Field label="Descrição">
          <textarea
            className="workspace-input"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <ModalError message={error} />
        <ModalFooter submitting={submitting} onClose={onClose} />
      </form>
    </CrmModal>
  );
}

const PAYMENT_METHODS = [
  { value: 'pix', label: 'Pix' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'dinheiro', label: 'Dinheiro' },
];

export function PaymentActionModal({ isOpen, submitting = false, onClose, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setMethod('');
      setDescription('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const value = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Informe um valor válido maior que zero.');
      return;
    }
    onSubmit({ amount: value, method, description: description.trim() });
  };

  return (
    <CrmModal isOpen={isOpen} onClose={onClose} title="Registrar pagamento">
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <Field label="Valor" required>
          <input
            className="workspace-input"
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0,00"
          />
        </Field>
        <Field label="Método">
          <select className="workspace-input" value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="">Selecionar</option>
            {PAYMENT_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Descrição">
          <textarea
            className="workspace-input"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <ModalError message={error} />
        <ModalFooter submitting={submitting} onClose={onClose} />
      </form>
    </CrmModal>
  );
}

export function ScheduleActionModal({ isOpen, submitting = false, onClose, onSubmit }) {
  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceId, setResourceId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setResourceId('');
    setStartsAt('');
    setEndsAt('');
    setNotes('');
    setError('');
    setLoadingResources(true);
    listResources({ limit: 100 })
      .then((result) => setResources(result.items || []))
      .catch(() => setResources([]))
      .finally(() => setLoadingResources(false));
  }, [isOpen]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!resourceId) {
      setError('Selecione um recurso.');
      return;
    }
    if (!startsAt || !endsAt) {
      setError('Informe início e fim do agendamento.');
      return;
    }
    onSubmit({ resourceId, startsAt, endsAt, notes: notes.trim() });
  };

  return (
    <CrmModal isOpen={isOpen} onClose={onClose} title="Agendar recurso">
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <Field label="Recurso" required>
          <select
            className="workspace-input"
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
            disabled={loadingResources}
          >
            <option value="">{loadingResources ? 'Carregando recursos...' : 'Selecionar'}</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>{resource.name}{resource.type ? ` (${resource.type})` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Início" required>
          <input
            className="workspace-input"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>
        <Field label="Fim" required>
          <input
            className="workspace-input"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </Field>
        <Field label="Observações">
          <textarea
            className="workspace-input"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <ModalError message={error} />
        <ModalFooter submitting={submitting} onClose={onClose} />
      </form>
    </CrmModal>
  );
}
