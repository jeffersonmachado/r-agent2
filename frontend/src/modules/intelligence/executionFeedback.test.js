import { describe, expect, it } from 'vitest';
import { describeExecutedAction, executedActionToneClass } from './executionFeedback';

describe('describeExecutedAction', () => {
  it('retorna null para entrada ausente ou inválida', () => {
    expect(describeExecutedAction(null)).toBeNull();
    expect(describeExecutedAction(undefined)).toBeNull();
    expect(describeExecutedAction({})).toBeNull();
    expect(describeExecutedAction({ status: 'executed' })).toBeNull();
  });

  it('create_task executado → sucesso com mensagem de tarefa', () => {
    const feedback = describeExecutedAction({ kind: 'create_task', status: 'executed', taskId: 't1' });
    expect(feedback.tone).toBe('success');
    expect(feedback.message).toBe('Tarefa criada no Workspace para execução operacional.');
  });

  it('send_message executado → sucesso com linguagem de entrega (sem mecanismo interno)', () => {
    const feedback = describeExecutedAction({ kind: 'send_message', status: 'executed', messageId: 'm1' });
    expect(feedback.tone).toBe('success');
    expect(feedback.message).toContain('Mensagem enviada');
    expect(feedback.message).not.toMatch(/queue|outbound|RPA|engine/i);
  });

  it('schedule executado → inclui data do follow-up formatada', () => {
    const feedback = describeExecutedAction({
      kind: 'schedule',
      status: 'executed',
      dueDate: '2026-09-10T14:00:00.000Z',
    });
    expect(feedback.tone).toBe('success');
    expect(feedback.message).toContain('Follow-up agendado para');
  });

  it('schedule executado sem dueDate válida → mensagem genérica', () => {
    const feedback = describeExecutedAction({ kind: 'schedule', status: 'executed', dueDate: 'invalid' });
    expect(feedback.message).toBe('Follow-up agendado no Workspace.');
  });

  it('skipped com reason conhecida → tom muted + motivo explícito', () => {
    const feedback = describeExecutedAction({ kind: 'send_message', status: 'skipped', reason: 'missing_conversation_id' });
    expect(feedback.tone).toBe('muted');
    expect(feedback.message).toContain('Sem conversa vinculada');
  });

  it('skipped com reason desconhecida → fallback genérico', () => {
    const feedback = describeExecutedAction({ kind: 'send_message', status: 'skipped', reason: 'outro' });
    expect(feedback.tone).toBe('muted');
    expect(feedback.message).toContain('dados insuficientes');
  });

  it('failed → tom warning com mensagem por kind', () => {
    expect(describeExecutedAction({ kind: 'send_message', status: 'failed' }).message).toContain('Inbox');
    expect(describeExecutedAction({ kind: 'schedule', status: 'failed' }).message).toContain('agende manualmente');
    expect(describeExecutedAction({ kind: 'create_task', status: 'failed' }).message)
      .toContain('não pôde ser executada automaticamente');
    expect(describeExecutedAction({ kind: 'x', status: 'failed' }).message).toContain('execute manualmente');
  });

  it('status desconhecido → null', () => {
    expect(describeExecutedAction({ kind: 'create_task', status: 'weird' })).toBeNull();
  });
});

describe('executedActionToneClass', () => {
  it('mapeia tons para classes e usa muted como fallback', () => {
    expect(executedActionToneClass('success')).toBe('text-status-success');
    expect(executedActionToneClass('warning')).toBe('text-status-warning');
    expect(executedActionToneClass('muted')).toBe('text-text-secondary');
    expect(executedActionToneClass('outro')).toBe('text-text-secondary');
  });
});
