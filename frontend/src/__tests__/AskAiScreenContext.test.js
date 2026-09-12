/**
 * Ask AI — contexto de TELA ligado às telas reais (A3).
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): o módulo vinha de uma heurística de
 * string ("primeiro segmento do path") e o widget NÃO ouvia `router:change` —
 * navegação client-side deixava o contexto preso na tela anterior.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

import { resolveScreen, normalizeRoute, buildScreenIndex, knownScreenCount } from '../askAi/screenRegistry';
import {
  buildAskAiContext,
  deriveScreenContext,
  setAskAiEntityContext,
  clearAskAiEntityContext,
  subscribeToRouteChanges,
  ENTITY_TYPES,
} from '../askAi/contextProvider';

describe('screenRegistry — vocabulário derivado da navegação canônica', () => {
  test('o índice de telas é construído a partir do menu (não é lista paralela)', () => {
    expect(knownScreenCount()).toBeGreaterThan(10);
    const index = buildScreenIndex();
    expect(index.get('/workspace')).toBeTruthy();
    expect(index.get('/workspace').id).toBeTruthy();
  });

  test('rota exata do menu é a própria tela (pageType index)', () => {
    const screen = resolveScreen('/workspace');
    expect(screen.pageType).toBe('index');
    expect(screen.module).toBe('workspace');
    expect(screen.screenId).toBeTruthy();
  });

  test('rota que estende uma tela conhecida herda o módulo e vira detail/nested', () => {
    // Um nível além da tela base = detalhe daquela tela.
    const detail = resolveScreen('/workspace/we-123');
    expect(detail.module).toBe('workspace');
    expect(detail.pageType).toBe('detail');

    // Dois ou mais níveis = navegação aninhada dentro da tela base.
    const deep = resolveScreen('/workspace/entity/abc/timeline');
    expect(deep.module).toBe('workspace');
    expect(deep.pageType).toBe('nested');
  });

  test('rota desconhecida não inventa módulo e cai no fallback por profundidade', () => {
    expect(resolveScreen('/rota-inexistente')).toEqual(expect.objectContaining({
      module: 'rota-inexistente', pageType: 'index',
    }));
    expect(resolveScreen('/rota-inexistente/x').pageType).toBe('nested');
  });

  test('normaliza query/hash/barra final e não aceita lixo', () => {
    expect(normalizeRoute('/workspace?tab=1')).toBe('/workspace');
    expect(normalizeRoute('/workspace/')).toBe('/workspace');
    expect(normalizeRoute('/workspace#top')).toBe('/workspace');
    expect(normalizeRoute('workspace')).toBe('/workspace');
    expect(normalizeRoute('/')).toBe('/');
  });
});

describe('contextProvider — contexto de tela seguro', () => {
  beforeEach(() => {
    clearAskAiEntityContext();
  });

  afterEach(() => {
    clearAskAiEntityContext();
  });

  test('deriva rota/módulo/tipo de página do registro de telas', () => {
    const context = deriveScreenContext('/workspace');
    expect(context).toEqual(expect.objectContaining({ route: '/workspace', module: 'workspace', pageType: 'index' }));
  });

  test('entidade de tela entra no contexto SEM workspaceEntityId quando ausente', () => {
    setAskAiEntityContext({ entityType: ENTITY_TYPES.FITNESS_STUDENT, entityId: 'student-42' });
    const context = buildAskAiContext('/fitness/students/student-42');
    expect(context.entityType).toBe('FITNESS_STUDENT');
    expect(context.entityId).toBe('student-42');
    expect(context).not.toHaveProperty('workspaceEntityId');
  });

  test('workspaceEntityId é propagado quando a tela declara (cliente 360)', () => {
    setAskAiEntityContext({
      entityType: ENTITY_TYPES.CUSTOMER,
      entityId: 'customer-7',
      workspaceEntityId: 'we-123',
      actionContext: 'timeline',
    });
    const context = buildAskAiContext('/workspace');
    expect(context.workspaceEntityId).toBe('we-123');
    expect(context.actionContext).toBe('timeline');
  });

  test('entidade inválida não vaza para o contexto (fail-closed)', () => {
    setAskAiEntityContext({ entityType: 'NAO_EXISTE', entityId: 'x' });
    expect(buildAskAiContext('/workspace')).not.toHaveProperty('entityType');

    setAskAiEntityContext({ entityType: ENTITY_TYPES.CUSTOMER, entityId: '/etc/passwd' });
    expect(buildAskAiContext('/workspace')).not.toHaveProperty('entityId');

    setAskAiEntityContext({ entityType: ENTITY_TYPES.CUSTOMER, entityId: 'ok', workspaceEntityId: 'in valido!' });
    expect(buildAskAiContext('/workspace')).not.toHaveProperty('workspaceEntityId');
  });

  test('nenhum campo de DOM/HTML entra no contexto', () => {
    setAskAiEntityContext({ entityType: ENTITY_TYPES.CUSTOMER, entityId: 'c1' });
    const context = buildAskAiContext('/workspace');
    expect(Object.keys(context).sort())
      .toEqual(['entityId', 'entityType', 'module', 'pageType', 'route']);
    expect(JSON.stringify(context)).not.toMatch(/<|>/);
  });
});

describe('contextProvider — navegação SPA', () => {
  test('subscribeToRouteChanges reage a router:change (navegação client-side)', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToRouteChanges(handler);

    window.history.pushState({}, '', '/workspace');
    window.dispatchEvent(new Event('router:change'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('/workspace');

    window.history.pushState({}, '', '/inbox');
    window.dispatchEvent(new Event('popstate'));
    window.dispatchEvent(new Event('hashchange'));
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenLastCalledWith('/inbox');

    unsubscribe();
    window.dispatchEvent(new Event('router:change'));
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test('handler inválido não quebra a assinatura', () => {
    const unsubscribe = subscribeToRouteChanges(null);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
