export function AccessDenied({ title = 'Acesso Negado', description, onBack }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>{title}</h2>
      <p style={{ color: '#6b7280', marginBottom: '1rem' }}>{description}</p>
      <button
        onClick={onBack}
        style={{
          padding: '0.5rem 1rem',
          backgroundColor: '#3b82f6',
          color: '#ffffff',
          border: 'none',
          borderRadius: '0.375rem',
          cursor: 'pointer',
        }}
      >
        Voltar para Atendimento
      </button>
    </div>
  );
}
