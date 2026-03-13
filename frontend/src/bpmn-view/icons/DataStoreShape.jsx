import React from 'react';

export function DataStoreShape({ className = '' }) {
  return (
    <svg viewBox="0 0 100 120" className={className} aria-hidden="true" focusable="false">
      <ellipse cx="50" cy="20" rx="36" ry="12" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M14 20 v68 c0 6.6 16.2 12 36 12 s36-5.4 36-12 V20" fill="none" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="50" cy="88" rx="36" ry="12" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M14 44 c0 6.6 16.2 12 36 12 s36-5.4 36-12" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.85" />
      <path d="M14 66 c0 6.6 16.2 12 36 12 s36-5.4 36-12" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.75" />
    </svg>
  );
}

export default DataStoreShape;
