import React from 'react';
import '../platform-shell.css';

export function PlatformDashboardPage({ children, className = '' }) {
  return <div className={`platform-shell platform-shell--dashboard ${className}`.trim()}>{children}</div>;
}
