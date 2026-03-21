import React from 'react';

export function PbxContactCenterGovernanceTabs({
  tab,
  loading,
  formPauseReason,
  setFormPauseReason,
  canSavePauseReason,
  handleSavePauseReason,
  filteredPauseReasons,
  formContactReason,
  setFormContactReason,
  canSaveContactReason,
  handleSaveContactReason,
  filteredContactReasons,
  formCampaign,
  setFormCampaign,
  canSaveCampaign,
  handleSaveCampaign,
  filteredCampaigns,
  setCcSelectedCampaignId,
  ccSelectedCampaignId,
  refreshCampaignList,
  campaignListDraftRow,
  setCampaignListDraftRow,
  handleCampaignListDraftAdd,
  campaignListDraftColumns,
  campaignListDraftGrid,
  handleAddCampaignListItems,
  campaignListDraftItems,
  setCampaignListDraftItems,
  filteredCampaignList,
  formScheduled,
  setFormScheduled,
  canSaveScheduled,
  handleSaveScheduledCallback,
  filteredScheduled,
  formClick2Call,
  setFormClick2Call,
  canCreateClick2Call,
  handleCreateClick2Call,
  click2CallVars,
  setClick2CallVars,
  handleClick2CallVarRemove,
  handleClick2CallVarAdd,
  filteredC2c,
  legacyXmlError,
  legacyXmlEntity,
  setLegacyXmlEntity,
  legacyXmlSupported,
  refreshLegacyXml,
  legacyXmlMeta,
  legacyXmlDraftId,
  setLegacyXmlDraftId,
  legacyXmlDraftFields,
  setLegacyXmlDraftFields,
  handleLegacyXmlUpsert,
  handleLegacyXmlRemoveField,
  handleLegacyXmlAddField,
  legacyXmlItems,
  filteredLegacyXmlItems,
  handleLegacyXmlEdit,
  handleLegacyXmlDelete,
  provisioningToken,
  tokenGovernance,
  provisioningTokenExpiresAt,
  provisioningTokenUpdatedAt,
  pbxAuditHours,
  setPbxAuditHours,
  refreshPbxAudit,
  pbxAuditByAction,
  filteredAuditItems,
  formatDateTime,
  PlatformGrid,
}) {
  return (
    <>
      {tab === 'ccPauseReasons' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Contact Center: Motivos de pausa</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 140px auto', gap: 8, marginBottom: 12 }}>
            <input
              placeholder="code (ex: ALMOCO)"
              value={formPauseReason.code}
              onChange={(e) => setFormPauseReason((s) => ({ ...s, code: e.target.value }))}
            />
            <input
              placeholder="descricao"
              value={formPauseReason.description}
              onChange={(e) => setFormPauseReason((s) => ({ ...s, description: e.target.value }))}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!formPauseReason.active}
                onChange={(e) => setFormPauseReason((s) => ({ ...s, active: e.target.checked }))}
              />
              ativo
            </label>
            <button onClick={handleSavePauseReason} disabled={!canSavePauseReason || loading} style={{ padding: '8px 12px' }}>
              Salvar
            </button>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Descricao</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ativo</th>
                </tr>
              </thead>
              <tbody>
                {filteredPauseReasons.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.code}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.description}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!r.active)}</td>
                  </tr>
                ))}
                {!filteredPauseReasons.length ? (
                  <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Nenhum motivo.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'ccContactReasons' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Contact Center: Motivos de contato</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 140px auto', gap: 8, marginBottom: 12 }}>
            <input
              placeholder="code (ex: INFO)"
              value={formContactReason.code}
              onChange={(e) => setFormContactReason((s) => ({ ...s, code: e.target.value }))}
            />
            <input
              placeholder="descricao"
              value={formContactReason.description}
              onChange={(e) => setFormContactReason((s) => ({ ...s, description: e.target.value }))}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!formContactReason.active}
                onChange={(e) => setFormContactReason((s) => ({ ...s, active: e.target.checked }))}
              />
              ativo
            </label>
            <button onClick={handleSaveContactReason} disabled={!canSaveContactReason || loading} style={{ padding: '8px 12px' }}>
              Salvar
            </button>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Descricao</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ativo</th>
                </tr>
              </thead>
              <tbody>
                {filteredContactReasons.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.code}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.description}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!r.active)}</td>
                  </tr>
                ))}
                {!filteredContactReasons.length ? (
                  <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Nenhum motivo.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'ccCampaigns' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Contact Center: Campanhas</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 160px 220px 220px 160px 160px auto', gap: 8, marginBottom: 12 }}>
            <input
              placeholder="id (opcional)"
              value={formCampaign.id}
              onChange={(e) => setFormCampaign((s) => ({ ...s, id: e.target.value }))}
            />
            <input
              placeholder="nome"
              value={formCampaign.name}
              onChange={(e) => setFormCampaign((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              placeholder="status"
              value={formCampaign.status}
              onChange={(e) => setFormCampaign((s) => ({ ...s, status: e.target.value }))}
            />
            <input
              type="datetime-local"
              value={formCampaign.startAt}
              onChange={(e) => setFormCampaign((s) => ({ ...s, startAt: e.target.value }))}
              title="inicio (opcional)"
            />
            <input
              type="datetime-local"
              value={formCampaign.endAt}
              onChange={(e) => setFormCampaign((s) => ({ ...s, endAt: e.target.value }))}
              title="fim (opcional)"
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!formCampaign.click2callEnabled}
                onChange={(e) => setFormCampaign((s) => ({ ...s, click2callEnabled: e.target.checked }))}
              />
              click2call
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!formCampaign.recordEnabled}
                onChange={(e) => setFormCampaign((s) => ({ ...s, recordEnabled: e.target.checked }))}
              />
              gravar
            </label>
            <button onClick={handleSaveCampaign} disabled={!canSaveCampaign || loading} style={{ padding: '8px 12px' }}>
              Salvar
            </button>
          </div>
          <div style={{ marginBottom: 10, opacity: 0.8 }}>
            Configurações avançadas ocultas (sem JSON).
          </div>
          <div style={{ overflow: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>ID</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Click2Call</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Gravar</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }} />
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.map((c) => (
                  <tr key={c.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.id}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.name}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.status}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!c.click2callEnabled)}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!c.recordEnabled)}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <button
                        onClick={() => setCcSelectedCampaignId(String(c.id))}
                        disabled={loading}
                        style={{ padding: '6px 10px' }}
                      >
                        Abrir lista
                      </button>
                    </td>
                  </tr>
                ))}
                {!filteredCampaigns.length ? <tr><td colSpan={6} style={{ padding: 8, opacity: 0.75 }}>Nenhuma campanha.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, opacity: 0.8 }}>
            Lista selecionada: <code>{ccSelectedCampaignId || '—'}</code>
          </div>
        </>
      ) : null}

      {tab === 'ccCampaignList' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Contact Center: Lista da campanha</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <select value={ccSelectedCampaignId} onChange={(e) => setCcSelectedCampaignId(e.target.value)}>
              <option value="">Selecione uma campanha…</option>
              {filteredCampaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button onClick={() => refreshCampaignList(ccSelectedCampaignId)} disabled={loading || !ccSelectedCampaignId} style={{ padding: '8px 12px' }}>
              Atualizar lista
            </button>
          </div>
          <div style={{ marginBottom: 10, opacity: 0.8 }}>
            Adicionar itens (sem JSON):
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 240px 1fr auto', gap: 8 }}>
            <input
              placeholder="DDD (opcional)"
              value={campaignListDraftRow.ddd}
              onChange={(e) => setCampaignListDraftRow((s) => ({ ...s, ddd: e.target.value }))}
            />
            <input
              placeholder="Telefone"
              value={campaignListDraftRow.phone}
              onChange={(e) => setCampaignListDraftRow((s) => ({ ...s, phone: e.target.value }))}
            />
            <input
              placeholder="Chave/Identificador (opcional)"
              value={campaignListDraftRow.key}
              onChange={(e) => setCampaignListDraftRow((s) => ({ ...s, key: e.target.value }))}
            />
            <button onClick={handleCampaignListDraftAdd} disabled={loading || !ccSelectedCampaignId} style={{ padding: '8px 12px' }}>
              Adicionar
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <PlatformGrid
              columns={campaignListDraftColumns}
              rows={campaignListDraftGrid.rows}
              sort={campaignListDraftGrid.sort}
              onSortChange={campaignListDraftGrid.handleSortChange}
              pagination={{ page: campaignListDraftGrid.page, pageSize: campaignListDraftGrid.pageSize, totalPages: campaignListDraftGrid.totalPages, totalRows: campaignListDraftGrid.totalRows, onPageChange: campaignListDraftGrid.handlePageChange, onPageSizeChange: campaignListDraftGrid.handlePageSizeChange }}
              emptyState={{ title: 'Lista vazia', description: 'Nenhum item pendente.' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={handleAddCampaignListItems} disabled={loading || !ccSelectedCampaignId || campaignListDraftItems.length === 0} style={{ padding: '8px 12px' }}>
              Adicionar na campanha
            </button>
            <button onClick={() => setCampaignListDraftItems([])} disabled={loading || campaignListDraftItems.length === 0} style={{ padding: '8px 12px' }}>
              Limpar lista
            </button>
          </div>
          <div style={{ overflow: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Phone</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>DDD</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Key</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaignList.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.phone}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.ddd || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.key || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.status || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.attempts ?? 0}</td>
                  </tr>
                ))}
                {!filteredCampaignList.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Sem itens.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'ccScheduled' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Contact Center: Callbacks agendados</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 220px 120px 1fr 140px 1fr auto', gap: 8, marginBottom: 12 }}>
            <input
              placeholder="id (opcional)"
              value={formScheduled.id}
              onChange={(e) => setFormScheduled((s) => ({ ...s, id: e.target.value }))}
            />
            <input
              type="datetime-local"
              value={formScheduled.scheduledAt}
              onChange={(e) => setFormScheduled((s) => ({ ...s, scheduledAt: e.target.value }))}
            />
            <input
              placeholder="DDD"
              value={formScheduled.ddd}
              onChange={(e) => setFormScheduled((s) => ({ ...s, ddd: e.target.value }))}
            />
            <input
              placeholder="phone (ex: 5511999999999)"
              value={formScheduled.phone}
              onChange={(e) => setFormScheduled((s) => ({ ...s, phone: e.target.value }))}
            />
            <input
              placeholder="status"
              value={formScheduled.status}
              onChange={(e) => setFormScheduled((s) => ({ ...s, status: e.target.value }))}
            />
            <input
              placeholder="descricao"
              value={formScheduled.description}
              onChange={(e) => setFormScheduled((s) => ({ ...s, description: e.target.value }))}
            />
            <button onClick={handleSaveScheduledCallback} disabled={!canSaveScheduled || loading} style={{ padding: '8px 12px' }}>
              Salvar
            </button>
          </div>
          <div style={{ marginBottom: 10, opacity: 0.8 }}>
            Configurações avançadas ocultas (sem JSON).
          </div>
          <div style={{ overflow: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Quando</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Phone</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Descricao</th>
                </tr>
              </thead>
              <tbody>
                {filteredScheduled.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {formatDateTime(it.scheduledAt)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {it.ddd ? `${it.ddd} ` : ''}{it.phone}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.status || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.description || '—'}</td>
                  </tr>
                ))}
                {!filteredScheduled.length ? <tr><td colSpan={4} style={{ padding: 8, opacity: 0.75 }}>Nenhum agendado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'ccClick2Call' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Contact Center: Click2Call</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 220px 120px 1fr auto', gap: 8, marginBottom: 12 }}>
            <select value={formClick2Call.campaignId} onChange={(e) => setFormClick2Call((s) => ({ ...s, campaignId: e.target.value }))}>
              <option value="">(sem campanha)</option>
              {filteredCampaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              placeholder="target (ramal/fila)"
              value={formClick2Call.target}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, target: e.target.value }))}
            />
            <input
              placeholder="DDD"
              value={formClick2Call.ddd}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, ddd: e.target.value }))}
            />
            <input
              placeholder="phone (ex: 5511999999999)"
              value={formClick2Call.phone}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, phone: e.target.value }))}
            />
            <button onClick={handleCreateClick2Call} disabled={!canCreateClick2Call || loading} style={{ padding: '8px 12px' }}>
              Criar
            </button>
          </div>
          <div style={{ marginTop: 8, marginBottom: 10, opacity: 0.8 }}>
            Originação (opcional):
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 120px 160px', gap: 8 }}>
            <input
              placeholder="channel (opcional)"
              value={formClick2Call.channel}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, channel: e.target.value }))}
            />
            <input
              placeholder="context (opcional)"
              value={formClick2Call.context}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, context: e.target.value }))}
            />
            <input
              placeholder="exten (opcional)"
              value={formClick2Call.exten}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, exten: e.target.value }))}
            />
            <input
              placeholder="priority"
              type="number"
              value={formClick2Call.priority}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, priority: e.target.value }))}
            />
            <input
              placeholder="timeout (ms)"
              type="number"
              value={formClick2Call.timeoutMs}
              onChange={(e) => setFormClick2Call((s) => ({ ...s, timeoutMs: e.target.value }))}
            />
          </div>
          <div style={{ marginTop: 10, opacity: 0.8 }}>Variáveis (opcional):</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8 }}>
            {(click2CallVars || []).map((row, idx) => (
              <React.Fragment key={idx}>
                <input
                  placeholder="nome"
                  value={row.key}
                  onChange={(e) => setClick2CallVars((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
                />
                <input
                  placeholder="valor"
                  value={row.value}
                  onChange={(e) => setClick2CallVars((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                />
                <button onClick={() => handleClick2CallVarRemove(idx)} disabled={loading} style={{ padding: '6px 10px' }}>
                  Remover
                </button>
              </React.Fragment>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={handleClick2CallVarAdd} disabled={loading} style={{ padding: '6px 10px' }}>
              Adicionar variável
            </button>
          </div>
          <div style={{ overflow: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Quando</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Target</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Phone</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Campanha</th>
                </tr>
              </thead>
              <tbody>
                {filteredC2c.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {formatDateTime(it.createdAt)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.target}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.ddd ? `${it.ddd} ` : ''}{it.phone}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.status}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.campaignId || '—'}</td>
                  </tr>
                ))}
                {!filteredC2c.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhuma solicitacao.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'legacyXml' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Legado: cadastros XML</h3>
          <div style={{ opacity: 0.8, marginBottom: 10 }}>
            Tela para manter compatibilidade com cadastros do RIPABX.
          </div>
          {legacyXmlError ? (
            <div style={{ marginBottom: 12, padding: 12, border: '1px solid rgba(255,180,0,0.35)', borderRadius: 10, background: 'rgba(255,180,0,0.08)' }}>
              <strong>Legado (XML) indisponível.</strong>
              <div style={{ marginTop: 6, opacity: 0.85 }}>{legacyXmlError}</div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              entidade:
              <select value={legacyXmlEntity} onChange={(e) => setLegacyXmlEntity(e.target.value)} disabled={loading}>
                {(legacyXmlSupported.length ? legacyXmlSupported : [
                  'ddr', 'grupo', 'desvio', 'transbordo', 'bloqueio', 'retorno', 'recusa', 'feriado', 'transferencia',
                  'operadora', 'rota_base', 'rota', 'tipo', 'categoria', 'fax', 'sala', 'interconexao', 'fila', 'motivo', 'motivo1',
                ]).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <button onClick={() => refreshLegacyXml()} disabled={loading} style={{ padding: '8px 12px' }}>
              Atualizar
            </button>
            <span style={{ opacity: 0.8 }}>
              arquivo: {legacyXmlMeta.file || '—'} | item: {legacyXmlMeta.itemTag || '—'}
            </span>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="ID do item"
                value={legacyXmlDraftId}
                onChange={(e) => setLegacyXmlDraftId(e.target.value)}
                disabled={loading}
              />
              <div style={{ opacity: 0.8 }}>Campos do item:</div>
              <button onClick={handleLegacyXmlUpsert} disabled={loading} style={{ padding: '8px 12px' }}>
                Salvar
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8 }}>
              {(legacyXmlDraftFields || []).map((row, idx) => (
                <React.Fragment key={idx}>
                  <input
                    placeholder="campo"
                    value={row.key}
                    onChange={(e) => setLegacyXmlDraftFields((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
                    disabled={loading}
                  />
                  <input
                    placeholder="valor"
                    value={row.value}
                    onChange={(e) => setLegacyXmlDraftFields((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                    disabled={loading}
                  />
                  <button onClick={() => handleLegacyXmlRemoveField(idx)} disabled={loading} style={{ padding: '6px 10px' }}>
                    Remover
                  </button>
                </React.Fragment>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={handleLegacyXmlAddField} disabled={loading} style={{ padding: '6px 10px' }}>
                Adicionar campo
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, opacity: 0.85 }}>
            Itens: <strong>{legacyXmlItems.length}</strong>
          </div>
          <div style={{ overflow: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>ID</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Resumo</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }} />
                </tr>
              </thead>
              <tbody>
                {filteredLegacyXmlItems.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {it.id}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ opacity: 0.9 }}>
                        {(Object.keys(it || {})
                          .filter((k) => k !== 'id' && k !== '_attrs')
                          .slice(0, 6)
                          .map((k) => `${k}=${String(it[k]).slice(0, 40)}`)
                          .join(' | ')) || '—'}
                      </span>
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <button
                        onClick={() => handleLegacyXmlEdit(it)}
                        disabled={loading}
                        style={{ padding: '6px 10px', marginRight: 8 }}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleLegacyXmlDelete(it.id)}
                        disabled={loading}
                        style={{ padding: '6px 10px' }}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
                {!filteredLegacyXmlItems.length ? (
                  <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Sem itens (ou entidade vazia).</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'governance' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Governança PBX</h3>
          <div style={{ marginBottom: 12, padding: 12, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div><strong>Token:</strong> {provisioningToken || '—'}</div>
              <div><strong>Status:</strong> {tokenGovernance.message}{tokenGovernance.remainingLabel ? ` (${tokenGovernance.remainingLabel})` : ''}</div>
              <div><strong>Expira em:</strong> {formatDateTime(provisioningTokenExpiresAt, 'sem expiração')}</div>
              <div><strong>Atualizado em:</strong> {formatDateTime(provisioningTokenUpdatedAt)}</div>
            </div>
          </div>

          <h4 style={{ marginTop: 0 }}>Auditoria PBX (ações `pbx.*`)</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            <input
              placeholder="janela em horas"
              value={pbxAuditHours}
              onChange={(e) => setPbxAuditHours(e.target.value)}
              style={{ maxWidth: 180 }}
            />
            <button onClick={refreshPbxAudit} disabled={loading} style={{ padding: '8px 12px' }}>
              Atualizar auditoria
            </button>
          </div>
          <div style={{ marginBottom: 12, opacity: 0.8 }}>
            {Object.entries(pbxAuditByAction).slice(0, 6).map(([action, count]) => (
              <span key={action} style={{ marginRight: 14 }}>{action}: <strong>{count}</strong></span>
            ))}
            {!Object.keys(pbxAuditByAction).length ? 'Sem eventos na janela selecionada.' : null}
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Timestamp</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ação</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Usuário</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Recurso</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {filteredAuditItems.map((item, idx) => (
                  <tr key={`${item.timestamp || 't'}-${item.action || 'a'}-${idx}`}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {formatDateTime(item.timestamp)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{item.action || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{item.username || item.agentId || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{item.resource || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ opacity: 0.9 }}>
                        {(item.details && typeof item.details === 'object'
                          ? Object.entries(item.details).slice(0, 6).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' | ')
                          : '') || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
                {!filteredAuditItems.length ? (
                  <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhum evento PBX encontrado.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
