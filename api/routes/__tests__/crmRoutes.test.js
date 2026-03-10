'use strict';

jest.mock('../../core/operational-playbooks', () => ({
  operationalPlaybookEngine: {
    listSuggestedPlaybooksForContact: jest.fn(),
  },
}));

const { operationalPlaybookEngine } = require('../../core/operational-playbooks');
const { handleCrmRoutes } = require('../crmRoutes');

function createContext(pathname) {
  const sendJson = jest.fn();
  return {
    req: {
      url: `${pathname}?limit=7`,
      headers: { host: 'localhost' },
      tenantId: 'tenant-1',
      agent: { id: 'agent-1', tenantId: 'tenant-1' },
    },
    res: {},
    method: 'GET',
    pathname,
    deps: {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson,
      hasJsonContentType: jest.fn(() => false),
      parseJsonBody: jest.fn(),
      logger: { error: jest.fn() },
    },
  };
}

describe('handleCrmRoutes playbooks aliases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    operationalPlaybookEngine.listSuggestedPlaybooksForContact.mockResolvedValue({
      ok: true,
      items: [{ id: 'playbook-1' }],
    });
  });

  test.each([
    '/api/crm/contacts/contact-1/playbooks',
    '/api/operational/crm/contact/contact-1/playbooks',
  ])('delegates %s to the same canonical playbook service', async (pathname) => {
    const context = createContext(pathname);

    const handled = await handleCrmRoutes(context);

    expect(handled).toBe(true);
    expect(operationalPlaybookEngine.listSuggestedPlaybooksForContact).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      limit: 7,
    });
    expect(context.deps.sendJson).toHaveBeenCalledWith(
      context.res,
      200,
      expect.objectContaining({ ok: true }),
    );
  });
});
