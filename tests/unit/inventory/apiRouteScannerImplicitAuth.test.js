'use strict';

const path = require('path');

// eslint-disable-next-line global-require
const { scanApiRoutes } = require('../../../api/services/qa/inventory/apiRouteScanner');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

/**
 * Falha observada (2026-08-03): 130 rotas mutáveis ficavam apenas VISITED na
 * API Surface Wave porque o inventário reportava authRequired=false para
 * rotas protegidas. Dois idiomas reais do projeto escapavam à análise estática:
 *
 * 1. Helper de permissão que chama helper de auth DENTRO do controller
 *    delegado (project-management): o método deleteProject chama apenas
 *    ensurePermission(req, res, 'delete') — e ensurePermission chama
 *    ensureAuth internamente. O scanner via a permissão mas não a auth.
 *
 * 2. Helper de auth+permissão em módulo irmão NÃO-controller (rag-documents):
 *    ensureRagPermission vive em ragRouteUtils.js e o scanner só carregava
 *    requires com "controller" no nome — auth e permissão ficavam invisíveis.
 *
 * Referência de verdade (probe ao vivo, 2026-08-03):
 *   curl -X DELETE http://localhost:3001/projects/probe       → 401
 *   curl -X DELETE http://localhost:3001/rag/documents/probe  → 401
 */
describe('apiRouteScanner — auth implícita (helper de permissão → auth, módulos irmãos não-controller)', () => {
  const itemsById = new Map();

  beforeAll(() => {
    const result = scanApiRoutes({ rootDir: ROOT_DIR });
    for (const item of result.items) itemsById.set(item.id, item);
  });

  test('DELETE /projects/:projectId é protegido (ensurePermission → ensureAuth no controller delegado)', () => {
    const item = itemsById.get('api:DELETE:/projects/:projectId');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
    expect(item.authorization.some((a) => a.startsWith('ensurePermission'))).toBe(true);
  });

  test('POST /projects é protegido (mesmo idioma)', () => {
    const item = itemsById.get('api:POST:/projects');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('DELETE /rag/documents/:id é protegido (ensureRagPermission em ragRouteUtils.js, módulo não-controller)', () => {
    const item = itemsById.get('api:DELETE:/rag/documents/:id');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
    expect(item.authorization.some((a) => a.startsWith('ensureRagPermission'))).toBe(true);
  });

  test('POST /rag/documents é protegido (mesmo idioma)', () => {
    const item = itemsById.get('api:POST:/rag/documents');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('DELETE /templates/:id é protegido (auth adicionada ao handler em 2026-08-03)', () => {
    const item = itemsById.get('api:DELETE:/templates/:id');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('DELETE /webhooks/:webhookId é protegido (router delega via runHandled; auth vive no handler irmão)', () => {
    // O scan direto de router.delete('/webhooks/:webhookId', runHandled(...))
    // não vê auth; o scan do handler irmão vê. O dedup por id deve MESCLAR —
    // a evidência mais forte (auth detectada em qualquer caminho) vence.
    // Probe ao vivo (2026-08-03): anônimo → 401.
    const item = itemsById.get('api:DELETE:/webhooks/:webhookId');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('DELETE /bulk-campaigns/:campaignId é protegido (mesmo idioma runHandled)', () => {
    const item = itemsById.get('api:DELETE:/bulk-campaigns/:campaignId');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('DELETE /tenants/:tenantId é protegido (handler por referência controller.deleteTenant)', () => {
    const item = itemsById.get('api:DELETE:/tenants/:tenantId');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('POST /api/beauty/appointment é protegido (ensureAuth de beautyRouteHelpers.js, módulo *Helpers)', () => {
    // O helper ensureAuth vive em beautyRouteHelpers.js — nem "controller" nem
    // "utils" no nome, então o módulo irmão nunca era carregado.
    // Probe ao vivo (2026-08-03): anônimo → 401.
    const item = itemsById.get('api:POST:/api/beauty/appointment');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('POST /api/fitness/attendance/check-in é protegido (ensureAuth injetado via ctx e chamado no handler)', () => {
    // ensureAuth chega por ctx (não é def local nem import): a chamada direta
    // `ensureAuth(req, res, ...)` no corpo da rota é evidência suficiente —
    // mesmo idioma dos controllers de config/beauty.
    // Probe ao vivo (2026-08-03): anônimo → 401.
    const item = itemsById.get('api:POST:/api/fitness/attendance/check-in');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });
});
