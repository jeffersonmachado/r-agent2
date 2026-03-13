import React from 'react';

export function DataObjectShape({ className = '' }) {
  return (
    <svg viewBox="0 0 80 100" className={className} aria-hidden="true" focusable="false">
      <path
        d="M16 8 h32 l16 16 v64 h-48 z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M48 8 v16 h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default DataObjectShape;
