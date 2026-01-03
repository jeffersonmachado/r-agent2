/**
 * Template base para páginas seguindo o padrão do projeto
 * 
 * Estrutura:
 * 1. Imports padrão (useAuth, useRouter, useToast, useConfirmDialog, Button)
 * 2. Proteção de rota com useAuth
 * 3. Estrutura HTML:
 *    - support-page (classe principal)
 *    - support-header (com h1 e support-controls)
 *    - Conteúdo com classes do tema (bg-bg-elevated, text-text-primary, etc.)
 * 4. Modais com padrão: fixed inset-0 bg-black/50, bg-bg-elevated rounded-xl
 * 5. ToastContainer e ConfirmDialog no final
 * 
 * Classes do tema:
 * - bg-bg-elevated, bg-bg-secondary, bg-bg-primary
 * - text-text-primary, text-text-secondary, text-text-tertiary
 * - border-border-default, border-border-hover
 * - accent-primary, accent-hover
 * - status-success, status-error, status-warning
 */

export const PAGE_TEMPLATE = {
  structure: `
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>Título da Página</h1>
        </div>
        <div className="support-controls">
          <Button>Botão</Button>
        </div>
      </div>
      {/* Conteúdo */}
    </div>
  `,
  modal: `
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setShowModal(false);
        }
      }}
    >
      <div 
        className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Conteúdo do modal */}
      </div>
    </div>
  `,
  input: `
    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
  `,
  select: `
    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
  `,
  card: `
    className="bg-bg-elevated rounded-xl border border-border-default p-6 hover:shadow-lg transition-shadow"
  `,
};

