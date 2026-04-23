import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

export function ContextPanel({ agent, currentPath, tenantLabel = '' }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const { activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  const shortcuts = useMemo(() => (activeArea?.items || []).slice(0, 6), [activeArea]);

  return (
    <aside className="rap-context-panel" aria-label="Painel de contexto">
      <section className="rap-context-card">
        <h3>Contexto operacional</h3>
        <p>{activeArea?.description || 'Sem area ativa.'}</p>
        <div className="rap-context-meta">
          <span>Perfil: {agent?.role || 'desconhecido'}</span>
          <span>Conta: {tenantLabel || agent?.tenantId || 'n/d'}</span>
        </div>
      </section>

      <section className="rap-context-card">
        <h3>Atalhos da area</h3>
        <div className="rap-context-shortcuts">
          {shortcuts.length > 0 ? shortcuts.map((item) => (
            <NavigationLink key={item.id} to={item.path} className="rap-context-shortcut-link">
              {item.label}
            </NavigationLink>
          )) : <span className="rap-context-empty">Nenhum atalho disponivel.</span>}
        </div>
      </section>

      <section className="rap-context-card">
        <h3>Produtividade</h3>
        <ul className="rap-context-tips">
          <li>Use Ctrl/Cmd + K para abrir a paleta de comandos.</li>
          <li>Use a rail para alternar rapido entre macroareas.</li>
          <li>Mantenha o painel de contexto para apoio operacional.</li>
        </ul>
      </section>
    </aside>
  );
}

export default ContextPanel;
