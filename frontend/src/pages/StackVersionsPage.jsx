/**
 * Página "Versões da Stack"
 *
 * Exibe as versões e o estado da stack da plataforma:
 * - API (RAP)
 * - Runtime Node.js
 * - Banco de dados (PostgreSQL)
 * - RAG Service (Python/FastAPI + modelo de embeddings)
 *
 * Consome os endpoints públicos de health/version (sem dados sensíveis).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fetchJson } from '../api/client';
import logger from '../utils/logger';
import { useToast } from '../components/Toast';

function VersionCard({ title, icon, items, status, statusLabel }) {
  const tone = status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'error';
  return (
    <section
      style={{
        border: '1px solid var(--border, #2a2a2a)',
        borderRadius: '10px',
        padding: '18px 20px',
        marginBottom: '14px',
        background: 'var(--bg-surface, #151515)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
          <span aria-hidden="true" style={{ marginRight: '8px' }}>{icon}</span>
          {title}
        </h3>
        {statusLabel && (
          <span
            style={{
              fontSize: '0.75rem',
              padding: '3px 10px',
              borderRadius: '999px',
              fontWeight: 600,
              background: tone === 'ok' ? '#10331d' : tone === 'warn' ? '#332e10' : '#33151a',
              color: tone === 'ok' ? '#3ddc84' : tone === 'warn' ? '#e0b341' : '#f06',
            }}
          >
            {statusLabel}
          </span>
        )}
      </header>
      <dl style={{ margin: 0, display: 'grid', gap: '6px' }}>
        {items.map((item) => (
          <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <dt style={{ color: 'var(--text-muted, #9a9a9a)' }}>{item.key}</dt>
            <dd style={{ margin: 0, fontFamily: 'monospace', textAlign: 'right' }}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function StackVersionsPage() {
  const { showToast } = useToast();
  const [version, setVersion] = useState(null);
  const [system, setSystem] = useState(null);
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [versionData, systemData, dbData] = await Promise.allSettled([
        fetchJson('/version', { method: 'GET', timeoutMs: 8000 }),
        fetchJson('/system/status', { method: 'GET', timeoutMs: 8000 }),
        fetchJson('/health/db', { method: 'GET', timeoutMs: 8000 }),
      ]);

      setVersion(versionData.status === 'fulfilled' ? versionData.value : null);
      setSystem(systemData.status === 'fulfilled' ? systemData.value : null);
      setDb(dbData.status === 'fulfilled' ? dbData.value : null);
      setLastUpdate(new Date());
      logger.debug('[StackVersions] Versões carregadas', { version: versionData.status, system: systemData.status, db: dbData.status });
    } catch (err) {
      logger.error('[StackVersions] Erro ao carregar versões', err);
      showToast('Erro ao carregar versões da stack', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const apiItems = version
    ? [
        { key: 'Nome', value: version.name || 'RAP' },
        { key: 'Versão', value: `v${version.version || 'unknown'}` },
        { key: 'Ambiente', value: version.env || 'unknown' },
        { key: 'Node.js', value: version.runtime?.node || 'unknown' },
        { key: 'Plataforma', value: `${version.runtime?.platform || '?'} ${version.runtime?.arch || ''}`.trim() },
        { key: 'Uptime', value: version.runtime?.uptimeSec != null ? `${Math.floor(version.runtime.uptimeSec / 60)}m ${version.runtime.uptimeSec % 60}s` : 'unknown' },
      ]
    : [{ key: 'Status', value: 'Indisponível' }];

  const rag = system?.services?.ragService;
  const ragItems = rag?.details
    ? [
        { key: 'Vector Store', value: rag.details.vectorStore || 'unknown' },
        { key: 'Modelo de Embeddings', value: rag.details.embeddingModel || 'unknown' },
        { key: 'Documentos indexados', value: String(rag.details.indexedDocuments ?? 0) },
        { key: 'Chunks', value: String(rag.details.indexedChunks ?? 0) },
      ]
    : [{ key: 'Status', value: rag?.status || 'Indisponível' }];

  const redis = system?.services?.redis;
  const redisItems = redis?.details
    ? [
        { key: 'Versão', value: redis.details.version || 'unknown' },
        { key: 'Porta', value: redis.details.port != null ? String(redis.details.port) : 'unknown' },
      ]
    : [{ key: 'Status', value: redis?.status || 'Indisponível' }];

  const ws = system?.services?.webSocket;
  const wsItems = [{ key: 'Status', value: ws?.status || 'Indisponível' }];

  const dbItems = [];
  if (version?.database?.serverVersion) {
    dbItems.push({ key: 'Servidor', value: version.database.serverVersion });
  }
  if (db) {
    dbItems.push({ key: 'Status', value: db.status || 'unknown' });
    if (db.db?.database) dbItems.push({ key: 'Banco', value: db.db.database });
    if (db.db?.host) dbItems.push({ key: 'Host', value: db.db.host });
    if (db.latencyMs != null) dbItems.push({ key: 'Latência', value: `${db.latencyMs}ms` });
    if (db.migrations) dbItems.push({ key: 'Migrations', value: `${db.migrations.applied ?? 0} aplicadas / ${db.migrations.pending ?? 0} pendentes` });
  }
  if (dbItems.length === 0) dbItems.push({ key: 'Status', value: 'Indisponível' });

  const online = (s) => (s === 'healthy' || s === 'ok' ? 'ok' : 'error');

  return (
    <div style={{ padding: '24px', maxWidth: '820px', margin: '0 auto' }}>
      <header style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '1.5rem', margin: '0 0 4px' }}>🧩 Versões da Stack</h1>
        <p style={{ color: 'var(--text-muted, #9a9a9a)', margin: 0, fontSize: '0.9rem' }}>
          Versões e estado dos serviços da plataforma RAP/r-agent2.
        </p>
        {lastUpdate && (
          <p style={{ color: 'var(--text-muted, #9a9a9a)', margin: '6px 0 0', fontSize: '0.78rem' }}>
            Atualizado em {lastUpdate.toLocaleTimeString('pt-BR')}
          </p>
        )}
      </header>

      {loading && !version && !system && !db ? (
        <p style={{ color: 'var(--text-muted, #9a9a9a)' }}>Carregando…</p>
      ) : (
        <>
          <VersionCard
            title="API (RAP)"
            icon="⚙️"
            items={apiItems}
            status={version ? 'ok' : 'error'}
            statusLabel={version ? 'online' : 'offline'}
          />
          <VersionCard
            title="Banco de Dados (PostgreSQL)"
            icon="🗄️"
            items={dbItems}
            status={db?.status === 'ok' ? 'ok' : 'error'}
            statusLabel={db?.status === 'ok' ? 'ok' : 'fail'}
          />
          <VersionCard
            title="RAG Service"
            icon="🧠"
            items={ragItems}
            status={online(rag?.status)}
            statusLabel={rag?.status === 'healthy' ? 'healthy' : rag?.status || 'offline'}
          />
          <VersionCard
            title="Redis"
            icon="⚡"
            items={redisItems}
            status={online(redis?.status)}
            statusLabel={redis?.status === 'healthy' ? 'healthy' : redis?.status || 'offline'}
          />
          <VersionCard
            title="WebSocket"
            icon="🔌"
            items={wsItems}
            status={online(ws?.status)}
            statusLabel={ws?.status === 'healthy' ? 'conectado' : ws?.status || 'offline'}
          />
        </>
      )}

      <button
        type="button"
        onClick={load}
        style={{
          marginTop: '8px',
          padding: '8px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border, #2a2a2a)',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        🔄 Atualizar
      </button>
    </div>
  );
}

export default StackVersionsPage;
