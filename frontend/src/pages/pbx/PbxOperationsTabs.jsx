import React from 'react';

export function PbxOperationsTabs({
  tab,
  loading,
  AGENTS_FIELD_CLASS,
  AGENTS_SELECT_CLASS,
  QUEUE_STRATEGY_OPTIONS,
  formQueue,
  setFormQueue,
  canSaveQueue,
  handleSaveQueue,
  filteredQueues,
  handleEditQueue,
  selectedQueueId,
  setSelectedQueueId,
  formQm,
  setFormQm,
  canSaveQm,
  handleSaveQueueMember,
  filteredQueueMembers,
  handleDeleteQueueMember,
  handleDialplanPreview,
  handleDialplanApply,
  dialplanRows,
  configVersions,
  formatDateTime,
  handleRollbackVersion,
  audioAssetsError,
  audioKind,
  setAudioKind,
  handleAudioRefresh,
  setAudioFile,
  handleAudioUpload,
  audioFile,
  filteredAudioAssets,
  buildApiUrl,
  recordingsError,
  recordingPolicyError,
  recordingPolicy,
  setRecordingPolicy,
  handleSaveRecordingPolicy,
  handleRecordingsRefresh,
  handleRecordingsScan,
  filteredRecordings,
  cdrFilters,
  setCdrFilters,
  handleCdrSearch,
  filteredCdrItems,
  Button,
}) {
  return (
    <>
      {tab === 'queues' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Filas</h3>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-4 mb-4 shadow-lg">
            <div style={{ display: 'grid', gridTemplateColumns: '140px 220px 160px 110px 110px 110px 110px auto', gap: 8, marginBottom: 8 }}>
              <input className={AGENTS_FIELD_CLASS} placeholder="Ramal da fila" value={formQueue.queueNumber} onChange={(e) => setFormQueue((s) => ({ ...s, queueNumber: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="Nome interno (fallback)" value={formQueue.name} onChange={(e) => setFormQueue((s) => ({ ...s, name: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="Nome da fila" value={formQueue.displayName} onChange={(e) => setFormQueue((s) => ({ ...s, displayName: e.target.value }))} />
              <select className={AGENTS_SELECT_CLASS} value={formQueue.strategy} onChange={(e) => setFormQueue((s) => ({ ...s, strategy: e.target.value }))}>
                {QUEUE_STRATEGY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input className={AGENTS_FIELD_CLASS} placeholder="timeout" type="number" value={formQueue.timeout} onChange={(e) => setFormQueue((s) => ({ ...s, timeout: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="retry" type="number" value={formQueue.retry} onChange={(e) => setFormQueue((s) => ({ ...s, retry: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="wrapuptime" type="number" value={formQueue.wrapuptime} onChange={(e) => setFormQueue((s) => ({ ...s, wrapuptime: e.target.value }))} />
              <Button onClick={handleSaveQueue} disabled={!canSaveQueue || loading} variant="primary">Salvar</Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 110px 120px 120px 120px 120px 120px 1fr 110px auto', gap: 8, marginBottom: 12 }}>
              <input className={AGENTS_FIELD_CLASS} placeholder="maxlen" type="number" value={formQueue.maxlen} onChange={(e) => setFormQueue((s) => ({ ...s, maxlen: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="Inclui" value={formQueue.inclui} onChange={(e) => setFormQueue((s) => ({ ...s, inclui: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="Exclui" value={formQueue.exclui} onChange={(e) => setFormQueue((s) => ({ ...s, exclui: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="Parar" value={formQueue.parar} onChange={(e) => setFormQueue((s) => ({ ...s, parar: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="Retornar" value={formQueue.retornar} onChange={(e) => setFormQueue((s) => ({ ...s, retornar: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="Transferir" value={formQueue.transferir} onChange={(e) => setFormQueue((s) => ({ ...s, transferir: e.target.value }))} />
              <input className={AGENTS_FIELD_CLASS} placeholder="URL de atendimento" value={formQueue.url} onChange={(e) => setFormQueue((s) => ({ ...s, url: e.target.value }))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!formQueue.tocar} onChange={(e) => setFormQueue((s) => ({ ...s, tocar: e.target.checked }))} />
                Tocar
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!formQueue.anunciar} onChange={(e) => setFormQueue((s) => ({ ...s, anunciar: e.target.checked }))} />
                Anunciar
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!formQueue.autoatendimento} onChange={(e) => setFormQueue((s) => ({ ...s, autoatendimento: e.target.checked }))} />
                Auto Atend.
              </label>
            </div>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Ramal</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Nome</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Display</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Strategy</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueues.map((q) => (
                  <tr key={q.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{q?.options?.queueNumber || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{q.name}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{q.displayName || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{q.strategy || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>
                      <Button onClick={() => handleEditQueue(q)} disabled={loading} size="sm" variant="ghost">Editar</Button>
                    </td>
                  </tr>
                ))}
                {!filteredQueues.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhuma fila encontrada.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'queueMembers' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Membros de fila (realtime)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1fr 120px 120px auto', gap: 8, marginBottom: 12 }}>
            <select value={selectedQueueId} onChange={(e) => setSelectedQueueId(e.target.value)}>
              <option value="">Selecione uma fila…</option>
              {filteredQueues.map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
            <select value={formQm.memberType} onChange={(e) => setFormQm((s) => ({ ...s, memberType: e.target.value }))}>
              <option value="extension">extension</option>
              <option value="external">external</option>
            </select>
            <input placeholder="memberRef (ex: 1001 ou PJSIP/x)" value={formQm.memberRef} onChange={(e) => setFormQm((s) => ({ ...s, memberRef: e.target.value }))} />
            <input placeholder="penalty" value={formQm.penalty} onChange={(e) => setFormQm((s) => ({ ...s, penalty: e.target.value }))} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!formQm.paused} onChange={(e) => setFormQm((s) => ({ ...s, paused: e.target.checked }))} />
              paused
            </label>
            <button onClick={handleSaveQueueMember} disabled={!canSaveQm || loading} style={{ padding: '8px 12px' }}>Adicionar</button>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Ref</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Penalty</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Paused</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }} />
                </tr>
              </thead>
              <tbody>
                {filteredQueueMembers.map((m) => (
                  <tr key={m.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{m.memberType}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{m.memberRef}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{m.penalty ?? '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{String(!!m.paused)}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>
                      <button onClick={() => handleDeleteQueueMember(m.id)} disabled={loading} style={{ padding: '6px 10px' }}>
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
                {!filteredQueueMembers.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhum membro encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'dialplan' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Dialplan (realtime)</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={handleDialplanPreview} disabled={loading} style={{ padding: '8px 12px' }}>Preview</button>
            <button onClick={handleDialplanApply} disabled={loading} style={{ padding: '8px 12px' }}>Aplicar</button>
          </div>
          <div style={{ opacity: 0.85, marginBottom: 8 }}>
            {Array.isArray(dialplanRows) ? `Linhas: ${dialplanRows.length}` : 'Clique em Preview para ver o dialplan.'}
          </div>
          {Array.isArray(dialplanRows) ? (
            <pre style={{ padding: 12, borderRadius: 8, background: 'var(--color-bg-tertiary)', overflow: 'auto' }}>
              {dialplanRows.slice(0, 500).map((r, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={idx}>
                  [{r.context}] exten=&gt; {r.exten},{r.priority},{r.app}({r.appdata})
                </div>
              ))}
              {dialplanRows.length > 500 ? <div>… (truncado)</div> : null}
            </pre>
          ) : null}
          <h4 style={{ marginTop: 16 }}>Histórico de versões</h4>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Versão</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Assinatura</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Data</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }} />
                </tr>
              </thead>
              <tbody>
                {configVersions.map((v) => (
                  <tr key={v.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{v.version}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{v.status || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{v?.summary?.dialplan?.signature || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>
                      {formatDateTime(v.createdAt)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>
                      <button
                        onClick={() => handleRollbackVersion(v.version)}
                        disabled={loading || !Array.isArray(v?.summary?.dialplan?.rows) || v.summary.dialplan.rows.length === 0}
                        style={{ padding: '6px 10px' }}
                      >
                        Rollback
                      </button>
                    </td>
                  </tr>
                ))}
                {!configVersions.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Sem versões registradas.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'media' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Mídia (áudios)</h3>
          {audioAssetsError ? (
            <div style={{ marginBottom: 12, padding: 12, border: '1px solid var(--color-warning-border, rgba(200,140,0,0.4))', borderRadius: 10, background: 'var(--color-warning-bg, rgba(200,140,0,0.08))' }}>
              <strong>Não foi possível carregar os áudios.</strong>
              <div style={{ marginTop: 6, opacity: 0.85 }}><code>{audioAssetsError}</code></div>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              kind:
              <input value={audioKind} onChange={(e) => setAudioKind(e.target.value)} style={{ width: 140 }} />
            </label>
            <button onClick={handleAudioRefresh} disabled={loading} style={{ padding: '8px 12px' }}>Atualizar</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
            <button onClick={handleAudioUpload} disabled={loading || !audioFile} style={{ padding: '8px 12px' }}>Upload</button>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Nome</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Download</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudioAssets.map((a) => (
                  <tr key={a.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{a.name}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>
                      <a href={buildApiUrl(`/api/pbx/audio-assets/file?id=${encodeURIComponent(a.id)}`)}>baixar</a>
                    </td>
                  </tr>
                ))}
                {!filteredAudioAssets.length ? <tr><td colSpan={2} style={{ padding: 8, opacity: 0.75 }}>Nenhum áudio encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'recordings' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Gravações</h3>
          {recordingsError || recordingPolicyError ? (
            <div style={{ marginBottom: 12, padding: 12, border: '1px solid var(--color-warning-border, rgba(200,140,0,0.4))', borderRadius: 10, background: 'var(--color-warning-bg, rgba(200,140,0,0.08))' }}>
              <strong>Gravações indisponíveis neste ambiente.</strong>
              <div style={{ marginTop: 6, opacity: 0.85 }}>
                {recordingPolicyError ? <div>Política: <code>{recordingPolicyError}</code></div> : null}
                {recordingsError ? <div>Lista: <code>{recordingsError}</code></div> : null}
              </div>
              <div style={{ marginTop: 8, opacity: 0.8 }}>
                Dica: confirme migrations e o acesso ao banco. Em produção, isso deve estar ok.
              </div>
            </div>
          ) : null}
          <div style={{ marginBottom: 12, padding: 12, border: '1px dashed var(--color-border-default)', borderRadius: 8 }}>
            <strong>Política de gravação (tenant)</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 220px 220px 220px auto', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!recordingPolicy.enabled}
                  onChange={(e) => setRecordingPolicy((s) => ({ ...s, enabled: e.target.checked }))}
                />
                Gravação habilitada
              </label>
              <input
                placeholder="Retenção (dias)"
                value={recordingPolicy.retentionDays}
                onChange={(e) => setRecordingPolicy((s) => ({ ...s, retentionDays: e.target.value }))}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!recordingPolicy.maskPhoneNumbers}
                  onChange={(e) => setRecordingPolicy((s) => ({ ...s, maskPhoneNumbers: e.target.checked }))}
                />
                Mascarar números
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!recordingPolicy.requireConsent}
                  onChange={(e) => setRecordingPolicy((s) => ({ ...s, requireConsent: e.target.checked }))}
                />
                Exigir consentimento
              </label>
              <button onClick={handleSaveRecordingPolicy} disabled={loading} style={{ padding: '8px 12px' }}>Salvar política</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={handleRecordingsRefresh} disabled={loading} style={{ padding: '8px 12px' }}>Atualizar</button>
            <button onClick={handleRecordingsScan} disabled={loading} style={{ padding: '8px 12px' }}>Scan volume</button>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Uniqueid</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Origem</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Destino</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Download</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecordings.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{r.uniqueid || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{r.src || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{r.dst || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>
                      <a href={buildApiUrl(`/api/pbx/recordings/file?id=${encodeURIComponent(r.id)}`)}>baixar</a>
                    </td>
                  </tr>
                ))}
                {!filteredRecordings.length ? <tr><td colSpan={4} style={{ padding: 8, opacity: 0.75 }}>Nenhuma gravação encontrada.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'cdr' ? (
        <>
          <h3 style={{ marginTop: 0 }}>CDR</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 12 }}>
            <input placeholder="limit" value={cdrFilters.limit} onChange={(e) => setCdrFilters((s) => ({ ...s, limit: e.target.value }))} />
            <input placeholder="from (ISO)" value={cdrFilters.from} onChange={(e) => setCdrFilters((s) => ({ ...s, from: e.target.value }))} />
            <input placeholder="to (ISO)" value={cdrFilters.to} onChange={(e) => setCdrFilters((s) => ({ ...s, to: e.target.value }))} />
            <input placeholder="src" value={cdrFilters.src} onChange={(e) => setCdrFilters((s) => ({ ...s, src: e.target.value }))} />
            <input placeholder="dst" value={cdrFilters.dst} onChange={(e) => setCdrFilters((s) => ({ ...s, dst: e.target.value }))} />
            <input placeholder="uniqueid" value={cdrFilters.uniqueid} onChange={(e) => setCdrFilters((s) => ({ ...s, uniqueid: e.target.value }))} />
            <button onClick={handleCdrSearch} disabled={loading} style={{ padding: '8px 12px' }}>Buscar</button>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Calldate</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Src</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Dst</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Disposition</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Duration</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>Uniqueid</th>
                </tr>
              </thead>
              <tbody>
                {filteredCdrItems.map((c) => (
                  <tr key={c.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{c.calldate ? new Date(c.calldate).toISOString() : '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{c.src || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{c.dst || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{c.disposition || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{c.duration ?? '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--color-border-default)' }}>{c.uniqueid}</td>
                  </tr>
                ))}
                {!filteredCdrItems.length ? <tr><td colSpan={6} style={{ padding: 8, opacity: 0.75 }}>Nenhum CDR encontrado (ainda).</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
