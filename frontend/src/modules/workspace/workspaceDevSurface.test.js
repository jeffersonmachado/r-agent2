import { describe, expect, it } from 'vitest';
import {
  DEV_SURFACE_TAB,
  SANITIZED_EVENT_SUMMARY,
  getOperationalLabels,
  getSidebarFilters,
  getWorkspaceTabs,
  isDevSurfaceVisible,
  sanitizeOperationalEvent,
} from './workspaceDevSurface';

describe('workspaceDevSurface — superfície de engenharia DEVELOPMENT-only', () => {
  it('isDevSurfaceVisible: apenas DEVELOPMENT', () => {
    expect(isDevSurfaceVisible('DEVELOPMENT')).toBe(true);
    expect(isDevSurfaceVisible('SUPPORT')).toBe(false);
    expect(isDevSurfaceVisible('PRODUCTION')).toBe(false);
    expect(isDevSurfaceVisible(undefined)).toBe(false);
    expect(isDevSurfaceVisible(null)).toBe(false);
  });

  it('tabs: DEVELOPMENT vê a tab QA/RPA; SUPPORT e PRODUCTION não', () => {
    expect(getWorkspaceTabs('DEVELOPMENT')).toContain(DEV_SURFACE_TAB);
    expect(getWorkspaceTabs('SUPPORT')).not.toContain(DEV_SURFACE_TAB);
    expect(getWorkspaceTabs('PRODUCTION')).not.toContain(DEV_SURFACE_TAB);
  });

  it('sidebar: SUPPORT recebe o rótulo sanitizado, nunca o técnico', () => {
    const devFilters = getSidebarFilters('DEVELOPMENT').map((f) => f.label);
    const supportFilters = getSidebarFilters('SUPPORT').map((f) => f.label);
    const prodFilters = getSidebarFilters('PRODUCTION').map((f) => f.label);

    expect(devFilters).toContain('Falha QA/RPA');
    expect(supportFilters).toContain('Incidentes operacionais');
    expect(supportFilters).not.toContain('Falha QA/RPA');
    expect(prodFilters).toContain('Incidentes operacionais');
    expect(prodFilters).not.toContain('Falha QA/RPA');
  });

  it('labels operacionais: SUPPORT recebe labels sanitizados (sem terminologia QA/RPA)', () => {
    const supportLabels = getOperationalLabels('SUPPORT');
    expect(supportLabels.failurePill).toBe('Incidente');
    expect(supportLabels.failuresCardTitle).toBe('Incidentes operacionais');

    const devLabels = getOperationalLabels('DEVELOPMENT');
    expect(devLabels.failurePill).toBe('QA/RPA');
  });

  it('sanitizeOperationalEvent: DEVELOPMENT preserva detalhe técnico', () => {
    const event = {
      id: 'ev-1',
      type: 'evidence',
      source: 'qa-mesh',
      summary: 'Falha QA na wave 3',
      detailUrl: '/dev/qa-waves',
      refId: 'run-123',
    };

    const sanitized = sanitizeOperationalEvent(event, 'DEVELOPMENT');
    expect(sanitized.summary).toBe('Falha QA na wave 3');
    expect(sanitized.refId).toBe('run-123');
    expect(sanitized.detailUrl).toBe('/dev/qa-waves');
  });

  it('sanitizeOperationalEvent: SUPPORT recebe outcome sanitizado, sem IDs/refs/links técnicos', () => {
    const event = {
      id: 'ev-1',
      type: 'evidence',
      source: 'qa-mesh',
      summary: 'Falha QA na wave 3',
      detailUrl: '/dev/qa-waves',
      refId: 'run-123',
    };

    const sanitized = sanitizeOperationalEvent(event, 'SUPPORT');
    expect(sanitized.summary).toBe(SANITIZED_EVENT_SUMMARY);
    expect(sanitized.refId).toBeNull();
    expect(sanitized.detailUrl).toBeNull();
    expect(sanitized.source).toBe('operação');
  });

  it('sanitizeOperationalEvent: PRODUCTION recebe outcome sanitizado', () => {
    const event = {
      id: 'ev-1',
      type: 'evidence',
      source: 'rpa',
      summary: 'Replay falhou',
      detailUrl: '/rpa-replays',
      refId: 'run-9',
    };

    const sanitized = sanitizeOperationalEvent(event, 'PRODUCTION');
    expect(sanitized.summary).toBe(SANITIZED_EVENT_SUMMARY);
    expect(sanitized.refId).toBeNull();
    expect(sanitized.detailUrl).toBeNull();
  });
});
