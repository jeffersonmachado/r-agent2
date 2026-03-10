import React from 'react';
import '../platform-shell.css';

export function PlatformHubPage({ children, className = '' }) {
  return <div className={`platform-shell platform-shell--hub ${className}`.trim()}>{children}</div>;
}
