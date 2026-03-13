import React from 'react';

export function MessageEventIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="3.5" y="6" width="17" height="12" rx="1.8" ry="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.6 7.3 L12 12.9 L19.4 7.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export default MessageEventIcon;
