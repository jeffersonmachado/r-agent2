import { describe, expect, it } from 'vitest';
import { navigationMenu } from './menu';
import { filterNavigationTree } from '../utils/menuPermissions';
import { buildWorkspaceAreas } from './workspaceAreas';

/** Agente super_admin equivalente ao `systemadmin` do runtime local. */
const superAdminAgent = { role: 'super_admin', username: 'systemadmin', tenantId: 'system' };

function resolveAreas(currentPath) {
  const filteredMenu = filterNavigationTree(superAdminAgent, navigationMenu, {});
  return buildWorkspaceAreas(filteredMenu, currentPath);
}

describe('área Dev (rail DEV)', () => {
  it('resolve /dev/engineering para a área dev (nunca para admin)', () => {
    const { activeArea } = resolveAreas('/dev/engineering');
    expect(activeArea.id).toBe('dev');
  });

  it('resolve /dev para a área dev', () => {
    const { activeArea } = resolveAreas('/dev');
    expect(activeArea.id).toBe('dev');
  });

  it('expõe Central Dev e Engineering entre os itens da área dev', () => {
    const { areas } = resolveAreas('/dev/engineering');
    const dev = areas.find((area) => area.id === 'dev');
    expect(dev).toBeTruthy();
    const paths = dev.items.map((item) => item.path);
    expect(paths[0]).toBe('/dev');
    expect(paths).toContain('/dev/engineering');
    expect(paths).toContain('/dev/engineering/findings');
    expect(paths).not.toContain('/dev/qa-waves');
    expect(paths).not.toContain('/dev/system-status');
  });

  it('não reivindica a engenharia na área admin, mantendo o monitoramento sob /dev', () => {
    const { areas } = resolveAreas('/dev/engineering');
    const admin = areas.find((area) => area.id === 'admin');
    const paths = admin.items.map((item) => item.path);
    expect(paths).not.toContain('/dev/engineering');
    expect(paths).not.toContain('/dev');
    expect(paths).toContain('/dev/system-status');
    expect(paths).toContain('/dev/stack-versions');
    expect(paths).toContain('/dev/qa-waves');
  });

  it('mantém a área dev oculta quando o agente não é super_admin', () => {
    const filteredMenu = filterNavigationTree({ role: 'operator', username: 'ana', tenantId: 'acme' }, navigationMenu, {});
    const { areas } = buildWorkspaceAreas(filteredMenu, '/workspace');
    expect(areas.some((area) => area.id === 'dev')).toBe(false);
  });

  it('não rouba /config do Admin (ancestral `plataforma` não é página da área dev)', () => {
    expect(resolveAreas('/config').activeArea.id).toBe('admin');
    expect(resolveAreas('/tenants').activeArea.id).toBe('admin');
    expect(resolveAreas('/qa-mesh').activeArea.id).toBe('admin');
  });

  it('mantém os Replays RPA (SUPPORT) no Admin, não em Dev', () => {
    const { areas } = resolveAreas('/rpa-replays');
    const dev = areas.find((area) => area.id === 'dev');
    const admin = areas.find((area) => area.id === 'admin');
    expect(dev.items.map((item) => item.path)).not.toContain('/rpa-replays');
    expect(admin.items.map((item) => item.path)).toContain('/rpa-replays');
  });
});
