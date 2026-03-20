import React from 'react';

export function DashboardFeatureCard({ icon, title, description, category, color, onClick }) {
  return (
    <button onClick={onClick} className="block text-left w-full">
      <div className="bg-bg-elevated rounded-xl border border-border-default hover:shadow-lg transition-shadow p-6 cursor-pointer h-full">
        <div className="flex items-start justify-between mb-3">
          <div className={`${color} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
            {icon}
          </div>
          <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">
            {category}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
    </button>
  );
}
