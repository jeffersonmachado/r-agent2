'use strict';

jest.mock('../../db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

const { getSequelize } = require('../../db/sequelize');
const ticketCrmIntegrationService = require('../ticketCrmIntegrationService');

describe('ticketCrmIntegrationService with normalized_context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ticketCrmIntegrationService.sequelize = null;
    ticketCrmIntegrationService.models = null;
  });

  test('usa entidades/tags/funnel do normalized_context ao criar contato CRM', async () => {
    const contact = { id: 'crm-contact-1', accountId: 'crm-account-1', name: 'Contato', update: jest.fn(async () => true) };
    const CrmContact = { findOrCreate: jest.fn(async () => [contact, true]) };
    const CrmActivity = { create: jest.fn(async () => ({ id: 'crm-activity-1' })) };

    getSequelize.mockReturnValue({ models: { CrmContact, CrmActivity, CrmAccount: {} } });

    const ticket = {
      id: 'ticket-1',
      tenant_key: 'tenant-1',
      channel_type: 'whatsapp',
      created_at: new Date().toISOString(),
      last_user_message: 'Erro no pedido',
      status: 'waiting',
      queue: 'support',
      phone_number: null,
      crm_contact_id: null,
      context: {
        customer_name: 'Ana Cliente',
        normalized_context: {
          tags: ['intent:support', 'topic:suporte'],
          entities: {
            phone: { value: '5511999999999', source: 'regex', confidence: 0.9, updated_at: new Date().toISOString() },
            email: { value: 'ana@example.com', source: 'regex', confidence: 0.9, updated_at: new Date().toISOString() },
          },
          funnel_state: { stage: 'support', intent: 'support', severity: 'high', next_action: 'handoff' },
        },
      },
      update: jest.fn(async () => true),
    };

    const out = await ticketCrmIntegrationService.syncTicketToCrm(ticket);

    expect(out).toBe(contact);
    expect(CrmContact.findOrCreate).toHaveBeenCalledTimes(1);
    const args = CrmContact.findOrCreate.mock.calls[0][0];
    expect(args.where).toEqual(expect.objectContaining({ tenant_key: 'tenant-1', phone: '5511999999999' }));
    expect(args.defaults.attributes.tags).toEqual(expect.arrayContaining(['intent:support', 'topic:suporte']));
    expect(args.defaults.attributes.customFields.funnel_stage).toBe('support');
    expect(args.defaults.attributes.customFields.funnel_intent).toBe('support');
    expect(args.defaults.attributes.customFields.funnel_severity).toBe('high');
    expect(ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      crm_contact_id: 'crm-contact-1',
      crm_account_id: 'crm-account-1',
    }), expect.any(Object));
    expect(CrmActivity.create).toHaveBeenCalledTimes(1);
  });

  test('lê normalized_context via context.metadata.normalized_context', async () => {
    const contact = { id: 'crm-contact-2', accountId: null, name: 'Contato', update: jest.fn(async () => true) };
    const CrmContact = { findOrCreate: jest.fn(async () => [contact, true]) };
    const CrmActivity = { create: jest.fn(async () => ({ id: 'crm-activity-2' })) };

    getSequelize.mockReturnValue({ models: { CrmContact, CrmActivity, CrmAccount: {} } });

    const ticket = {
      id: 'ticket-2',
      tenant_key: 'tenant-2',
      channel_type: 'whatsapp',
      created_at: new Date().toISOString(),
      last_user_message: 'Meu e-mail é beta@example.com',
      status: 'waiting',
      queue: 'support',
      phone_number: null,
      crm_contact_id: null,
      context: {
        metadata: {
          normalized_context: {
            entities: {
              email: { value: 'beta@example.com', source: 'regex', confidence: 0.9, updated_at: new Date().toISOString() },
            },
            funnel_state: { stage: 'awareness', intent: 'unknown', severity: 'medium', next_action: 'ask' },
          },
        },
      },
      update: jest.fn(async () => true),
    };

    await ticketCrmIntegrationService.syncTicketToCrm(ticket);

    const args = CrmContact.findOrCreate.mock.calls[0][0];
    expect(args.where).toEqual(expect.objectContaining({ tenant_key: 'tenant-2', email: 'beta@example.com' }));
    expect(args.defaults.attributes.tags).toEqual(['atendimento']);
  });

  test('aceita ticket em camelCase (fluxo manual) e cria contato CRM com customerName', async () => {
    const contact = { id: 'crm-contact-3', accountId: null, name: 'Contato', update: jest.fn(async () => true) };
    const CrmContact = { findOrCreate: jest.fn(async () => [contact, true]) };
    const CrmActivity = { create: jest.fn(async () => ({ id: 'crm-activity-3' })) };

    getSequelize.mockReturnValue({ models: { CrmContact, CrmActivity, CrmAccount: {} } });

    const ticket = {
      id: 'ticket-3',
      tenantId: 'tenant-3',
      channelType: 'whatsapp',
      createdAt: new Date().toISOString(),
      lastUserMessage: 'Fluxo manual',
      status: 'waiting',
      queue: 'default',
      phoneNumber: '5511998888777',
      customerName: 'TESTE - Cliente Manual',
      crm_contact_id: null,
      context: {
        customerName: 'TESTE - Cliente Manual',
        variables: { customerName: 'TESTE - Cliente Manual' },
      },
      update: jest.fn(async () => true),
    };

    await ticketCrmIntegrationService.syncTicketToCrm(ticket);

    const args = CrmContact.findOrCreate.mock.calls[0][0];
    expect(args.where).toEqual(expect.objectContaining({ tenant_key: 'tenant-3', phone: '5511998888777' }));
    expect(args.defaults.name).toBe('TESTE - Cliente Manual');
    expect(CrmActivity.create).toHaveBeenCalledTimes(1);
  });
});
