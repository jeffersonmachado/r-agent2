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
          <h3 className="mt-0">Filas</h3>
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
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!formQueue.tocar} onChange={(e) => setFormQueue((s) => ({ ...s, tocar: e.target.checked }))} />
                Tocar
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!formQueue.anunciar} onChange={(e) => setFormQueue((s) => ({ ...s, anunciar: e.target.checked }))} />
                Anunciar
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!formQueue.autoatendimento} onChange={(e) => setFormQueue((s) => ({ ...s, autoatendimento: e.target.checked }))} />
                Auto Atend.
              </label>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="pbx-th">Ramal</th>
                  <th className="pbx-th">Nome</th>
                  <th className="pbx-th">Display</th>
                  <th className="pbx-th">Strategy</th>
                  <th className="pbx-th">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueues.map((q) => (
                  <tr key={q.id}>
                    <td className="pbx-td">{q?.options?.queueNumber || '—'}</td>
                    <td className="pbx-td">{q.name}</td>
                    <td className="pbx-td">{q.displayName || '—'}</td>
                    <td className="pbx-td">{q.strategy || '—'}</td>
                    <td className="pbx-td">
                      <Button onClick={() => handleEditQueue(q)} disabled={loading} size="sm" variant="ghost">Editar</Button>
                    </td>
                  </tr>
                ))}
                {!filteredQueues.length ? <tr><td colSpan={5} className="pbx-td opacity-75">Nenhuma fila encontrada.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'queueMembers' ? (
        <>
          <h3 className="mt-0">Membros de fila (realtime)</h3>
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
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!formQm.paused} onChange={(e) => setFormQm((s) => ({ ...s, paused: e.target.checked }))} />
              paused
            </label>
            <button onClick={handleSaveQueueMember} disabled={!canSaveQm || loading} className="px-3 py-2">Adicionar</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="pbx-th">Tipo</th>
                  <th className="pbx-th">Ref</th>
                  <th className="pbx-th">Penalty</th>
                  <th className="pbx-th">Paused</th>
                  <th className="pbx-th" />
                </tr>
              </thead>
              <tbody>
                {filteredQueueMembers.map((m) => (
                  <tr key={m.id}>
                    <td className="pbx-td">{m.memberType}</td>
                    <td className="pbx-td">{m.memberRef}</td>
                    <td className="pbx-td">{m.penalty ?? '—'}</td>
                    <td className="pbx-td">{String(!!m.paused)}</td>
                    <td className="pbx-td">
                      <button onClick={() => handleDeleteQueueMember(m.id)} disabled={loading} style={{ padding: '6px 10px' }}>
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
                {!filteredQueueMembers.length ? <tr><td colSpan={5} className="pbx-td opacity-75">Nenhum membro encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'dialplan' ? (
        <>
          <h3 className="mt-0">Dialplan (realtime)</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={handleDialplanPreview} disabled={loading} className="px-3 py-2">Preview</button>
            <button onClick={handleDialplanApply} disabled={loading} className="px-3 py-2">Aplicar</button>
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
          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="pbx-th">Versão</th>
                  <th className="pbx-th">Status</th>
                  <th className="pbx-th">Assinatura</th>
                  <th className="pbx-th">Data</th>
                  <th className="pbx-th" />
                </tr>
              </thead>
              <tbody>
                {configVersions.map((v) => (
                  <tr key={v.id}>
                    <td className="pbx-td">{v.version}</td>
                    <td className="pbx-td">{v.status || '—'}</td>
                    <td className="pbx-td">{v?.summary?.dialplan?.signature || '—'}</td>
                    <td className="pbx-td">
                      {formatDateTime(v.createdAt)}
                    </td>
                    <td className="pbx-td">
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
                {!configVersions.length ? <tr><td colSpan={5} className="pbx-td opacity-75">Sem versões registradas.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'media' ? (
        <>
          <h3 className="mt-0">Mídia (áudios)</h3>
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
            <button onClick={handleAudioRefresh} disabled={loading} className="px-3 py-2">Atualizar</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
            <button onClick={handleAudioUpload} disabled={loading || !audioFile} className="px-3 py-2">Upload</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="pbx-th">Nome</th>
                  <th className="pbx-th">Download</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudioAssets.map((a) => (
                  <tr key={a.id}>
                    <td className="pbx-td">{a.name}</td>
                    <td className="pbx-td">
                      <a href={buildApiUrl(`/api/pbx/audio-assets/file?id=${encodeURIComponent(a.id)}`)}>baixar</a>
                    </td>
                  </tr>
                ))}
                {!filteredAudioAssets.length ? <tr><td colSpan={2} className="pbx-td opacity-75">Nenhum áudio encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'recordings' ? (
        <>
          <h3 className="mt-0">Gravações</h3>
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
              <label className="flex items-center gap-1.5">
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
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!recordingPolicy.maskPhoneNumbers}
                  onChange={(e) => setRecordingPolicy((s) => ({ ...s, maskPhoneNumbers: e.target.checked }))}
                />
                Mascarar números
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!recordingPolicy.requireConsent}
                  onChange={(e) => setRecordingPolicy((s) => ({ ...s, requireConsent: e.target.checked }))}
                />
                Exigir consentimento
              </label>
              <button onClick={handleSaveRecordingPolicy} disabled={loading} className="px-3 py-2">Salvar política</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={handleRecordingsRefresh} disabled={loading} className="px-3 py-2">Atualizar</button>
            <button onClick={handleRecordingsScan} disabled={loading} className="px-3 py-2">Scan volume</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="pbx-th">Uniqueid</th>
                  <th className="pbx-th">Origem</th>
                  <th className="pbx-th">Destino</th>
                  <th className="pbx-th">Download</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecordings.map((r) => (
                  <tr key={r.id}>
                    <td className="pbx-td">{r.uniqueid || '—'}</td>
                    <td className="pbx-td">{r.src || '—'}</td>
                    <td className="pbx-td">{r.dst || '—'}</td>
                    <td className="pbx-td">
                      <a href={buildApiUrl(`/api/pbx/recordings/file?id=${encodeURIComponent(r.id)}`)}>baixar</a>
                    </td>
                  </tr>
                ))}
                {!filteredRecordings.length ? <tr><td colSpan={4} className="pbx-td opacity-75">Nenhuma gravação encontrada.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'cdr' ? (
        <>
          <h3 className="mt-0">CDR</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 12 }}>
            <input placeholder="limit" value={cdrFilters.limit} onChange={(e) => setCdrFilters((s) => ({ ...s, limit: e.target.value }))} />
            <input placeholder="from (ISO)" value={cdrFilters.from} onChange={(e) => setCdrFilters((s) => ({ ...s, from: e.target.value }))} />
            <input placeholder="to (ISO)" value={cdrFilters.to} onChange={(e) => setCdrFilters((s) => ({ ...s, to: e.target.value }))} />
            <input placeholder="src" value={cdrFilters.src} onChange={(e) => setCdrFilters((s) => ({ ...s, src: e.target.value }))} />
            <input placeholder="dst" value={cdrFilters.dst} onChange={(e) => setCdrFilters((s) => ({ ...s, dst: e.target.value }))} />
            <input placeholder="uniqueid" value={cdrFilters.uniqueid} onChange={(e) => setCdrFilters((s) => ({ ...s, uniqueid: e.target.value }))} />
            <button onClick={handleCdrSearch} disabled={loading} className="px-3 py-2">Buscar</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="pbx-th">Calldate</th>
                  <th className="pbx-th">Src</th>
                  <th className="pbx-th">Dst</th>
                  <th className="pbx-th">Disposition</th>
                  <th className="pbx-th">Duration</th>
                  <th className="pbx-th">Uniqueid</th>
                </tr>
              </thead>
              <tbody>
                {filteredCdrItems.map((c) => (
                  <tr key={c.id}>
                    <td className="pbx-td">{c.calldate ? new Date(c.calldate).toISOString() : '—'}</td>
                    <td className="pbx-td">{c.src || '—'}</td>
                    <td className="pbx-td">{c.dst || '—'}</td>
                    <td className="pbx-td">{c.disposition || '—'}</td>
                    <td className="pbx-td">{c.duration ?? '—'}</td>
                    <td className="pbx-td">{c.uniqueid}</td>
                  </tr>
                ))}
                {!filteredCdrItems.length ? <tr><td colSpan={6} className="pbx-td opacity-75">Nenhum CDR encontrado (ainda).</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
