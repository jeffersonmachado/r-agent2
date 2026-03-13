import React from 'react';

export function TimerEventIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="12" y1="12" x2="12" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="12" x2="15.2" y2="13.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="4.8" x2="12" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="19.2" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="12" y1="19.2" x2="12" y2="18" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4.8" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export default TimerEventIcon;
