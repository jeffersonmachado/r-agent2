import React from 'react';

export function PbxExtensionsAclsTabs({
  tab,
  loading,
  AGENTS_FIELD_CLASS,
  AGENTS_SELECT_CLASS,
  LEGACY_CONTEXT_OPTIONS,
  LEGACY_PROTOCOL_OPTIONS,
  LEGACY_TIPO_OPTIONS,
  handleNewExtension,
  showExtensionEditModal,
  isEditingExtension,
  formExt,
  setFormExt,
  acls,
  handleSaveExtension,
  canSaveExt,
  setShowExtensionEditModal,
  setIsEditingExtension,
  provisioningToken,
  tokenGovernance,
  provisioningTokenExpiresAt,
  provisioningTokenUpdatedAt,
  rotateExpiresInSec,
  setRotateExpiresInSec,
  handleRotateProvisioningToken,
  handleQuickRotate,
  handleRevokeProvisioningToken,
  rotatedToken,
  buildApiUrl,
  navigate,
  extensionsColumns,
  extensionsGrid,
  queueMetricsColumns,
  queueMetricsGrid,
  formAcl,
  setFormAcl,
  handleSaveAcl,
  canSaveAcl,
  refreshCore,
  aclsColumns,
  aclsGrid,
  PlatformGrid,
  Button,
  formatDateTime,
}) {
  return (
    <>
      {tab === 'extensions' ? (
        <>
          <div className="flex items-center justify-between gap-3 mb-6">
            <h3 className="text-xl font-semibold text-text-primary" style={{ marginTop: 0, marginBottom: 0 }}>Ramais</h3>
            <Button onClick={handleNewExtension} disabled={loading} variant="primary">➕ Incluir</Button>
          </div>
          {showExtensionEditModal ? (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
                <h4 className="text-2xl font-bold text-text-primary mb-6">
                  {isEditingExtension ? 'Editar Ramal' : 'Incluir Ramal'}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <input className={AGENTS_FIELD_CLASS} placeholder="Ramal" value={formExt.extension} disabled={isEditingExtension} onChange={(e) => setFormExt((s) => ({ ...s, extension: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Nome" value={formExt.displayName} onChange={(e) => setFormExt((s) => ({ ...s, displayName: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Usuário" value={formExt.authUsername} onChange={(e) => setFormExt((s) => ({ ...s, authUsername: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Senha" value={formExt.authPassword} onChange={(e) => setFormExt((s) => ({ ...s, authPassword: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="CallerID interno" value={formExt.calleridName} onChange={(e) => setFormExt((s) => ({ ...s, calleridName: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="CallerID número" value={formExt.calleridNumber} onChange={(e) => setFormExt((s) => ({ ...s, calleridNumber: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="CallerID externo" value={formExt.calleridExternal} onChange={(e) => setFormExt((s) => ({ ...s, calleridExternal: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Grupo(s) ex: 1,2" value={formExt.grupo} onChange={(e) => setFormExt((s) => ({ ...s, grupo: e.target.value }))} />
                  <select className={AGENTS_SELECT_CLASS} value={formExt.contexto} onChange={(e) => setFormExt((s) => ({ ...s, contexto: e.target.value }))}>
                    {LEGACY_CONTEXT_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select className={AGENTS_SELECT_CLASS} value={formExt.protocolo} onChange={(e) => setFormExt((s) => ({ ...s, protocolo: e.target.value }))}>
                    {LEGACY_PROTOCOL_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select className={AGENTS_SELECT_CLASS} value={formExt.tipo} onChange={(e) => setFormExt((s) => ({ ...s, tipo: e.target.value }))}>
                    {LEGACY_TIPO_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <input className={AGENTS_FIELD_CLASS} placeholder="Senha D (tipo=Senha)" value={formExt.senhad} onChange={(e) => setFormExt((s) => ({ ...s, senhad: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Chamadas" type="number" value={formExt.chamadas} onChange={(e) => setFormExt((s) => ({ ...s, chamadas: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Tempo" type="number" value={formExt.tempo} onChange={(e) => setFormExt((s) => ({ ...s, tempo: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Bloqueio (CIDR)" value={formExt.bloqueio} onChange={(e) => setFormExt((s) => ({ ...s, bloqueio: e.target.value }))} />
                  <input className={AGENTS_FIELD_CLASS} placeholder="Permissão (CIDR)" value={formExt.permissao} onChange={(e) => setFormExt((s) => ({ ...s, permissao: e.target.value }))} />
                  <label className="flex items-center gap-2 md:col-span-2">
                    ACL
                    <select className={AGENTS_SELECT_CLASS} value={formExt.aclId} onChange={(e) => setFormExt((s) => ({ ...s, aclId: e.target.value }))} disabled={loading}>
                      <option value="">(nenhuma)</option>
                      {(acls || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!formExt.gsm} onChange={(e) => setFormExt((s) => ({ ...s, gsm: e.target.checked }))} />
                    GSM
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!formExt.g729} onChange={(e) => setFormExt((s) => ({ ...s, g729: e.target.checked }))} />
                    G729
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!formExt.correio} onChange={(e) => setFormExt((s) => ({ ...s, correio: e.target.checked }))} />
                    Correio
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!formExt.webfone} onChange={(e) => setFormExt((s) => ({ ...s, webfone: e.target.checked }))} />
                    WebFone
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!formExt.gravar} onChange={(e) => setFormExt((s) => ({ ...s, gravar: e.target.checked }))} />
                    Gravar
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!formExt.provisioningEnabled}
                      onChange={(e) => setFormExt((s) => ({ ...s, provisioningEnabled: e.target.checked }))}
                    />
                    Provisionamento
                  </label>
                  <select
                    className={AGENTS_SELECT_CLASS}
                    value={formExt.provisioningVendor}
                    disabled={!formExt.provisioningEnabled}
                    onChange={(e) => setFormExt((s) => ({ ...s, provisioningVendor: e.target.value }))}
                  >
                    <option value="grandstream">grandstream</option>
                    <option value="avaya">avaya</option>
                  </select>
                  <input
                    className={AGENTS_FIELD_CLASS}
                    placeholder="MAC (12 hex, ex: 001122AABBCC)"
                    value={formExt.provisioningMac}
                    disabled={!formExt.provisioningEnabled}
                    onChange={(e) => setFormExt((s) => ({ ...s, provisioningMac: e.target.value }))}
                  />
                  <input
                    className={AGENTS_FIELD_CLASS}
                    placeholder="Modelo (opcional)"
                    value={formExt.provisioningModel}
                    disabled={!formExt.provisioningEnabled}
                    onChange={(e) => setFormExt((s) => ({ ...s, provisioningModel: e.target.value }))}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button onClick={handleSaveExtension} disabled={!canSaveExt || loading} variant="primary" className="flex-1">Salvar</Button>
                  <Button
                    onClick={() => {
                      setShowExtensionEditModal(false);
                      setIsEditingExtension(false);
                    }}
                    disabled={loading}
                    variant="ghost"
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div style={{ marginBottom: 16, padding: 12, border: '1px dashed var(--color-border-default)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong>Token de Provisionamento</strong>
              <span style={{ opacity: 0.75 }}>{provisioningToken || '—'}</span>
              <span style={{ opacity: 0.85 }}>
                status: {tokenGovernance.message}
                {tokenGovernance.remainingLabel ? ` (${tokenGovernance.remainingLabel})` : ''}
              </span>
              {provisioningTokenExpiresAt ? (
                <span style={{ opacity: 0.75 }}>expira: {formatDateTime(provisioningTokenExpiresAt)}</span>
              ) : null}
              {provisioningTokenUpdatedAt ? (
                <span style={{ opacity: 0.7 }}>atualizado: {formatDateTime(provisioningTokenUpdatedAt)}</span>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className={AGENTS_FIELD_CLASS}
                placeholder="expiresInSec (opcional)"
                value={rotateExpiresInSec}
                onChange={(e) => setRotateExpiresInSec(e.target.value)}
                style={{ maxWidth: 220 }}
              />
              <Button onClick={handleRotateProvisioningToken} disabled={loading} size="sm">Rotacionar token</Button>
              <Button onClick={() => handleQuickRotate(24 * 60 * 60)} disabled={loading} size="sm" variant="ghost">Rotação 24h</Button>
              <Button onClick={() => handleQuickRotate(7 * 24 * 60 * 60)} disabled={loading} size="sm" variant="ghost">Rotação 7d</Button>
              <Button onClick={() => handleQuickRotate(30 * 24 * 60 * 60)} disabled={loading} size="sm" variant="ghost">Rotação 30d</Button>
              <Button onClick={() => handleQuickRotate(0)} disabled={loading} size="sm" variant="ghost">Sem expiração</Button>
              <Button onClick={handleRevokeProvisioningToken} disabled={loading} size="sm" variant="danger">Revogar token</Button>
              {rotatedToken ? (
                <span style={{ opacity: 0.9 }}>Novo token: <code>{rotatedToken}</code></span>
              ) : null}
            </div>
            <div style={{ marginTop: 6, opacity: 0.7 }}>
              URL: <code>{buildApiUrl('/provision/<tenant>/<token>/<vendor>/<mac>')}</code>
            </div>
          </div>
          <div style={{ marginBottom: 16, padding: 12, border: '1px dashed var(--color-border-default)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>Provisionamento em Lote</strong>
              <p style={{ opacity: 0.75, marginTop: 4, marginBottom: 0 }}>
                O provisionamento em lote foi movido para uma tela dedicada.
              </p>
            </div>
            <Button onClick={() => navigate('/pbx/provisioning-lote')} size="sm" variant="primary">Abrir tela de lote</Button>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg mb-6">
            <PlatformGrid
              columns={extensionsColumns}
              rows={extensionsGrid.rows}
              sort={extensionsGrid.sort}
              onSortChange={extensionsGrid.handleSortChange}
              pagination={{ page: extensionsGrid.page, pageSize: extensionsGrid.pageSize, totalPages: extensionsGrid.totalPages, totalRows: extensionsGrid.totalRows, onPageChange: extensionsGrid.handlePageChange, onPageSizeChange: extensionsGrid.handlePageSizeChange }}
              emptyState={{ title: 'Sem ramais', description: 'Nenhum ramal encontrado.' }}
            />
          </div>
          <h4 style={{ marginTop: 16 }}>Métricas operacionais de fila</h4>
          <PlatformGrid
            columns={queueMetricsColumns}
            rows={queueMetricsGrid.rows}
            sort={queueMetricsGrid.sort}
            onSortChange={queueMetricsGrid.handleSortChange}
            pagination={{ page: queueMetricsGrid.page, pageSize: queueMetricsGrid.pageSize, totalPages: queueMetricsGrid.totalPages, totalRows: queueMetricsGrid.totalRows, onPageChange: queueMetricsGrid.handlePageChange, onPageSizeChange: queueMetricsGrid.handlePageSizeChange }}
            emptyState={{ title: 'Sem métricas', description: 'Sem métricas de filas.' }}
          />
        </>
      ) : null}

      {tab === 'acls' ? (
        <>
          <h3 style={{ marginTop: 0 }}>ACLs (permit/deny)</h3>
          <div style={{ opacity: 0.8, marginBottom: 10 }}>
            Cadastre listas de IP/rede para reutilizar nos ramais. O Asterisk referencia por ID (estável), então renomear não quebra os ramais.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 140px auto', gap: 8, marginBottom: 10 }}>
            <input
              placeholder="Nome (ex: Telefones VLAN)"
              value={formAcl.name}
              onChange={(e) => setFormAcl((s) => ({ ...s, name: e.target.value }))}
              disabled={loading}
            />
            <input
              placeholder="Descrição (opcional)"
              value={formAcl.description}
              onChange={(e) => setFormAcl((s) => ({ ...s, description: e.target.value }))}
              disabled={loading}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={formAcl.enabled !== false}
                onChange={(e) => setFormAcl((s) => ({ ...s, enabled: e.target.checked }))}
                disabled={loading}
              />
              ativo
            </label>
            <button onClick={handleSaveAcl} disabled={!canSaveAcl || loading} style={{ padding: '8px 12px' }}>
              Salvar
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <textarea
              rows={6}
              placeholder={'deny (um por linha, ex):\n0.0.0.0/0'}
              value={formAcl.deny}
              onChange={(e) => setFormAcl((s) => ({ ...s, deny: e.target.value }))}
              disabled={loading}
              style={{ width: '100%' }}
            />
            <textarea
              rows={6}
              placeholder={'permit (um por linha, ex):\n10.10.2.0/24'}
              value={formAcl.permit}
              onChange={(e) => setFormAcl((s) => ({ ...s, permit: e.target.value }))}
              disabled={loading}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <button
              onClick={() => setFormAcl({ id: '', name: '', description: '', enabled: true, deny: '', permit: '' })}
              disabled={loading}
              style={{ padding: '6px 10px' }}
            >
              Limpar formulário
            </button>
            <button onClick={refreshCore} disabled={loading} style={{ padding: '6px 10px' }}>
              Atualizar lista
            </button>
          </div>

          <PlatformGrid
            columns={aclsColumns}
            rows={aclsGrid.rows}
            sort={aclsGrid.sort}
            onSortChange={aclsGrid.handleSortChange}
            pagination={{ page: aclsGrid.page, pageSize: aclsGrid.pageSize, totalPages: aclsGrid.totalPages, totalRows: aclsGrid.totalRows, onPageChange: aclsGrid.handlePageChange, onPageSizeChange: aclsGrid.handlePageSizeChange }}
            emptyState={{ title: 'Sem ACLs', description: 'Nenhuma ACL cadastrada.' }}
          />
        </>
      ) : null}
    </>
  );
}