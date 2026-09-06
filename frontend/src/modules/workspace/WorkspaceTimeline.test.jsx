import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceTimeline } from './WorkspaceTimeline';

describe('modules/workspace/WorkspaceTimeline — voz no Customer 360', () => {
  it('evento de origem voice usa ícone de telefone e mantém o resumo da chamada', () => {
    render(
      <WorkspaceTimeline
        classification="PRODUCTION"
        loading={false}
        timeline={{
          total: 1,
          items: [
            {
              id: 'message:cmsg-1',
              type: 'message',
              source: 'voice',
              createdAt: '2026-09-06T10:00:25.000Z',
              summary: 'in: 📞 Chamada perdida de 5511999887766',
              detailUrl: '/inbox?conversationId=conv-voice',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('📞')).toBeInTheDocument();
    expect(screen.getByText('in: 📞 Chamada perdida de 5511999887766')).toBeInTheDocument();
    expect(screen.getByText('Origem voice')).toBeInTheDocument();
  });

  it('evento de mensagem de outro canal mantém o ícone padrão', () => {
    render(
      <WorkspaceTimeline
        classification="PRODUCTION"
        loading={false}
        timeline={{
          total: 1,
          items: [
            {
              id: 'message:cmsg-2',
              type: 'message',
              source: 'whatsapp',
              createdAt: '2026-09-06T10:05:00.000Z',
              summary: 'in: Oi, tudo bem?',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('💬')).toBeInTheDocument();
    expect(screen.queryByText('📞')).not.toBeInTheDocument();
  });
});
