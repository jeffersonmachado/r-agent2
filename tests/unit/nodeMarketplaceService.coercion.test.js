'use strict';

/**
 * Coercion-guard tests for nodeMarketplaceService.js
 * Verifies hostile toString() on item fields/tenantId don't crash the service.
 */

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => JSON.stringify({ items: [] })),
  writeFileSync: jest.fn(),
}));

const { listPublishedNodes, publishNode, revokeNode } = require('../../api/services/nodeMarketplaceService');

const hostileToString = () => {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', { get() { throw new Error('hostile toString'); } });
  Object.defineProperty(o, 'valueOf', { get() { throw new Error('hostile valueOf'); } });
  return o;
};

describe('nodeMarketplaceService – coercion guards', () => {
  beforeEach(() => jest.clearAllMocks());

  test('listPublishedNodes: hostile tenantId does not throw', () => {
    expect(() => listPublishedNodes({ tenantId: hostileToString() })).not.toThrow();
  });

  test('publishNode: hostile item fields do not throw', () => {
    const result = publishNode({
      tenantId: 'tenant1',
      node: {
        id: hostileToString(),
        label: hostileToString(),
        category: hostileToString(),
        version: hostileToString(),
      },
    });
    // With hostile toString, safeTrim returns '' so all fields are empty → invalid_node
    expect(result).toMatchObject({ ok: false });
  });

  test('revokeNode: hostile nodeId/tenantId do not throw', () => {
    expect(() => revokeNode({ tenantId: hostileToString(), nodeId: hostileToString() })).not.toThrow();
  });
});
