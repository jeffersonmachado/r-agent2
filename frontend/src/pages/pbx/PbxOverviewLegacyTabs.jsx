import React from 'react';

export function PbxOverviewLegacyTabs({
  tab,
  loading,
  openPbxSection,
  navigate,
  legacyTabMeta,
  normalizeLegacyLabel,
  Button,
}) {
  return (
    <>
      {tab === 'overview' ? (
        <>
          <h3 className="mt-0">Visão geral</h3>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Os cards de Visão Geral ficam no topo da página e redirecionam para a tela correspondente.
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => openPbxSection('extensions')} disabled={loading}>Gerenciar ramais</button>
            <button onClick={() => openPbxSection('queues')} disabled={loading}>Gerenciar filas</button>
            <button onClick={() => openPbxSection('dialplan')} disabled={loading}>Dialplan</button>
            <button onClick={() => openPbxSection('cdr')} disabled={loading}>CDR</button>
            <button onClick={() => navigate('/pbx/provisioning-lote')} disabled={loading}>Provisionamento em lote</button>
          </div>
        </>
      ) : null}

      {legacyTabMeta ? (
        <>
          <h3 className="mt-0">{normalizeLegacyLabel(legacyTabMeta.label)}</h3>
          <div style={{ opacity: 0.9, lineHeight: 1.6 }}>
            <div><strong>Seção referência:</strong> {legacyTabMeta.section}</div>
            <div><strong>Tela de referência:</strong> <code>{legacyTabMeta.href}</code></div>
            <div><strong>Status de paridade:</strong> {legacyTabMeta.status}</div>
            <div><strong>Observação:</strong> Esta aba existe para manter correspondência 1:1 com o menu de referência (`menu.php/menu2.php`).</div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {legacyTabMeta.mappedTab ? (
              <Button onClick={() => openPbxSection(legacyTabMeta.mappedTab)} size="sm" variant="primary">
                Ir para aba equivalente ({legacyTabMeta.mappedTab})
              </Button>
            ) : (
              <Button onClick={() => openPbxSection('governance')} size="sm" variant="ghost">
                Sem equivalente direto (ver Governança)
              </Button>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}