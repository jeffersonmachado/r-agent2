import React from 'react';

/**
 * Componente simples de seção colapsável usando apenas CSS
 */
export function CollapsibleSection({ 
  title, 
  children, 
  isCollapsed = false,
  onToggle,
  className = '',
  headerClassName = '',
  contentClassName = '',
}) {
  return (
    <div className={`collapsible-section ${className}`} data-collapsed={isCollapsed}>
      <button
        type="button"
        onClick={onToggle}
        className={`collapsible-section-header ${headerClassName}`}
        aria-expanded={!isCollapsed}
      >
        <span className="collapsible-section-title">{title}</span>
        <span className={`collapsible-section-icon collapse-btn-horizontal ${isCollapsed ? 'collapsed' : ''}`}></span>
      </button>
      {!isCollapsed && (
        <div className={`collapsible-section-content ${contentClassName}`}>
          {children}
        </div>
      )}
    </div>
  );
}

