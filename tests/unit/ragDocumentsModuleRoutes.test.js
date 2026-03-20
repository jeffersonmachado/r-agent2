'use strict';

const { createRagDocumentsRoutes } = require('../../api/modules/rag-documents/routes');

describe('rag-documents module', () => {
  test('router express monta middlewares para os subdominios do RAG', () => {
    const router = createRagDocumentsRoutes({
      buildDeps: () => ({
        requireAuth: jest.fn(),
        requirePermission: jest.fn(),
      }),
    });

    const middlewareLayers = router.stack.filter((layer) => !layer.route);
    expect(middlewareLayers).toHaveLength(5);
  });
});
