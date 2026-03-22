import React from 'react';

export function SupportPageLayout({ left, main, right, isMobile, isRightPanelCollapsed, hasSelection }) {
  const gridClassName = [
    'support-grid',
    isMobile ? 'is-mobile' : '',
    isMobile && !isRightPanelCollapsed ? 'right-open' : '',
    isMobile && hasSelection ? 'has-selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={gridClassName}>
      <div className="support-left-column">{left}</div>
      <div className="support-details-panel">
        <div className="support-details-split" style={{ display: 'flex', gap: '14px', minHeight: 0 }}>
          <div className="support-main-column" style={{ flex: 1, minWidth: 0 }}>
            {main}
          </div>
          {right}
        </div>
      </div>
    </div>
  );
}
