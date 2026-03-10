export function SupportDetailsSidebar({ isMobile, isRightPanelCollapsed, setIsRightPanelCollapsed, children }) {
  return (
    <>
      {isMobile && !isRightPanelCollapsed ? (
        <button
          type="button"
          className="support-right-panel-overlay"
          aria-label="Fechar painel lateral"
          onClick={() => setIsRightPanelCollapsed(true)}
        />
      ) : null}
      <div className="support-right-panel-wrap">
        {!isMobile ? (
          <button
            type="button"
            onClick={() => setIsRightPanelCollapsed((prev) => !prev)}
            className="support-right-panel-toggle"
            aria-label={isRightPanelCollapsed ? 'Abrir painel direito' : 'Fechar painel direito'}
            title={isRightPanelCollapsed ? 'Abrir painel direito' : 'Fechar painel direito'}
          >
            {isRightPanelCollapsed ? '◀' : '▶'}
          </button>
        ) : null}
        {!isRightPanelCollapsed ? (
          <div className="support-right-panel-content">
            {isMobile ? (
              <div className="support-right-panel-mobile-header">
                <strong>Painel lateral</strong>
                <button
                  type="button"
                  className="support-right-panel-mobile-close"
                  onClick={() => setIsRightPanelCollapsed(true)}
                  aria-label="Fechar painel lateral"
                >
                  ✕
                </button>
              </div>
            ) : null}
            {children}
          </div>
        ) : null}
      </div>
    </>
  );
}
