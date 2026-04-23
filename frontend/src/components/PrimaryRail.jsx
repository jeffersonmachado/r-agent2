import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

export function PrimaryRail({ agent, currentPath }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const { areas, activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  return (
    <aside className="rap-primary-rail" aria-label="Navegacao primaria">
      <div className="rap-primary-rail-brand">
        <span className="rap-primary-rail-mark">RAP</span>
      </div>

      <nav className="rap-primary-rail-nav">
        {areas.map((area) => (
          <NavigationLink
            key={area.id}
            to={area.path}
            className={`rap-primary-rail-item ${activeArea?.id === area.id ? 'is-active' : ''}`}
          >
            <span className="rap-primary-rail-item-icon" aria-hidden="true">{area.icon}</span>
            <span className="rap-primary-rail-item-label">{area.label}</span>
          </NavigationLink>
        ))}
      </nav>
    </aside>
  );
}

export default PrimaryRail;
