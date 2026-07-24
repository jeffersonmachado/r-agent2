import React from 'react';
import { useTheme } from '../../styles/themeContext';

export function DevDashboardSection({ title, children, action = null }) {
  const { theme } = useTheme();

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-xl md:text-2xl font-bold text-text-primary">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
