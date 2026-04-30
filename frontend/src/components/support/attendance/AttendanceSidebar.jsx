import React from 'react';

const MENU_SECTIONS = [
  {
    label: 'Cockpit',
    items: [],
  },
  {
    label: 'Relacionamento',
    items: ['Atendimento', 'Painel de monitoramento', 'Caixa de entrada', 'Configuracao'],
  },
  {
    label: 'CRM',
    items: [],
  },
  {
    label: 'Canais e Conteudo',
    items: [],
  },
  {
    label: 'Operacao',
    items: [],
  },
  {
    label: 'Automacao',
    items: [],
  },
];

export function AttendanceSidebar() {
  return (
    <aside className="attendance-sidebar" aria-label="Menu de capacidades">
      <div className="attendance-sidebar-brand">
        <div className="attendance-sidebar-logo">RAP</div>
        <div>
          <div className="attendance-sidebar-title">Runtime Access Portal</div>
          <div className="attendance-sidebar-subtitle">Navegacao por capacidades</div>
        </div>
      </div>

      <nav className="attendance-sidebar-menu">
        {MENU_SECTIONS.map((section) => (
          <div className="attendance-sidebar-section" key={section.label}>
            <div className="attendance-sidebar-section-title">{section.label}</div>
            {section.items.length > 0 ? (
              <div className="attendance-sidebar-items">
                {section.items.map((item) => (
                  <button
                    type="button"
                    key={`${section.label}-${item}`}
                    className={`attendance-sidebar-item ${item === 'Atendimento' ? 'is-active' : ''}`}
                    aria-current={item === 'Atendimento' ? 'page' : undefined}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}
