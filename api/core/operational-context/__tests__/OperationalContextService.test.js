'use strict';

const { OperationalContextService } = require('..');

describe('OperationalContextService', () => {
  test('monta contexto canônico por tenant', async () => {
    const service = new OperationalContextService({
      assembler: {
        assembleTenantContext: jest.fn().mockResolvedValue({
          ok: true,
          crmSummary: { total: 1 },
          scheduling: { totalAlerts: 2 },
          support: { waitingTickets: 3 },
          campaigns: [],
          callbacks: { total: 1 },
          tasks: { total: 2 },
          rag: { available: true },
          revenue: { totalOpen: 4 },
        }),
      },
    });

    const out = await service.assembleTenantContext({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.context.tenantId).toBe('tenant-1');
    expect(out.context.crm.summary).toEqual({ total: 1 });
    expect(out.context.team.support).toEqual({ waitingTickets: 3 });
  });

  test('monta contexto canônico por contato com contexto conversacional', async () => {
    const service = new OperationalContextService({
      assembler: {
        assembleContactContext: jest.fn().mockResolvedValue({
          ok: true,
          summary: { recentActivity: true },
          profile: { contact: { id: 'c1' } },
          schedules: [],
          scheduleStats: { total: 2 },
          revenue: { totalOpen: 1 },
          callbacks: { pending: 1 },
          flags: { hasUpcomingSchedule: true },
          rag: { available: true },
        }),
      },
      conversationContextService: {
        buildConversationContext: jest.fn().mockResolvedValue({
          context: { summary: 'conversation' },
        }),
      },
    });

    const out = await service.assembleContactContext({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      ticket: { id: 'ticket-1' },
      messages: [],
      userPrompt: 'oi',
    });

    expect(out.ok).toBe(true);
    expect(out.context.contactId).toBe('contact-1');
    expect(out.context.customer).toEqual({ id: 'c1' });
    expect(out.context.conversation).toEqual({ summary: 'conversation' });
  });
});
