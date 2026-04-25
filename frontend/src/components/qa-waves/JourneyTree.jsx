import React from 'react';

export function JourneyTree({ domains, selectedDomainId, selectedJourneyId, onSelectJourney }) {
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
                  <button
                    key={journey.journeyId}
                    type="button"
                    className={`qa-journey-tree-journey ${active ? 'active' : ''}`}
                    onClick={() => onSelectJourney(domain.id, journey.journeyId)}
                  >
                    <span>{journey.journeyName}</span>
                    <span className={`qa-business-status qa-business-status--${String(journey.status || 'warning').toLowerCase()}`}>
                      {journey.status || 'WARNING'}
                    </span>
                  </button>
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
