import React from 'react';

export function JourneyTree({ domains, selectedDomainId, selectedJourneyId, onSelectJourney, onDeleteJourney }) {
  const safeDomains = Array.isArray(domains) ? domains : [];

  return (
    <div className="qa-journey-tree">
      {safeDomains.map((domain) => {
        const domainActive = domain.id === selectedDomainId;
        const journeys = Array.isArray(domain.journeys) ? domain.journeys : [];

        return (
          <section key={domain.id} className="qa-journey-tree-domain">
            <h3 className={domainActive ? 'active' : ''}>{domain.name}</h3>
            <div className="qa-journey-tree-journeys">
              {journeys.map((journey) => {
                const active = journey.journeyId === selectedJourneyId;
                return (
                  <div key={journey.journeyId} className="relative flex items-center">
                    <button
                      type="button"
                      className={`qa-journey-tree-journey ${active ? 'active' : ''}`}
                      style={{ flex: 1, paddingRight: onDeleteJourney ? 24 : undefined }}
                      onClick={() => onSelectJourney(domain.id, journey.journeyId)}
                    >
                      <span>{journey.journeyName}</span>
                      <span className={`qa-business-status qa-business-status--${String(journey.status || 'warning').toLowerCase()}`}>
                        {journey.status || 'WARNING'}
                      </span>
                    </button>
                    {onDeleteJourney && (
                      <button
                        type="button"
                        title="Excluir jornada"
                        aria-label="Excluir jornada"
                        onClick={(e) => { e.stopPropagation(); onDeleteJourney(journey.journeyId, domain.id); }}
                        style={{
                          position: 'absolute',
                          right: 4,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--color-status-error)',
                          fontSize: 12,
                          lineHeight: 1,
                          padding: '2px 3px',
                          opacity: 0.6,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
              {journeys.length === 0 ? <p className="qa-empty">Sem jornadas</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default JourneyTree;
