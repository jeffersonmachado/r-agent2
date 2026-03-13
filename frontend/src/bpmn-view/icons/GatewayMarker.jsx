import React from 'react';

export function GatewayMarker({ bpmnType, className = '' }) {
  if (bpmnType === 'eventBasedGateway') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7.2 L13.6 10.3 L17 10.7 L14.5 13.1 L15.2 16.5 L12 14.8 L8.8 16.5 L9.5 13.1 L7 10.7 L10.4 10.3 Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (bpmnType === 'parallelGateway') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
        <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }

  if (bpmnType === 'inclusiveGateway') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default GatewayMarker;
