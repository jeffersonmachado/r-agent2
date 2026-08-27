import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../api/client';

const DOMAIN_DOC_ALIASES = {
  beauty: ['beauty'],
  fitness: ['fitness'],
  food: ['food'],
  clinic: ['clinic', 'clinica'],
  services: ['services', 'servicos'],
  market: ['market', 'mercado'],
  omnichannel: ['omnichannel'],
  core: ['core'],
};

/**
 * Determina se um documento (roteiro ou diagrama) pertence ao domínio, pelo
 * prefixo do nome do arquivo. Trata aliases (clinic/clinica, market/mercado,
 * services/servicos).
 */
export function isDocForDomain(fileName, domainId) {
  if (!fileName || !domainId) return false;
  const aliases = DOMAIN_DOC_ALIASES[domainId] || [domainId];
  const base = String(fileName).toLowerCase();
  return aliases.some((alias) => {
    const a = String(alias).toLowerCase();
    return base.startsWith(`jornada-${a}-`)
      || base.startsWith(`vertical-${a}-`)
      || base === `vertical-${a}.md`
      || base.startsWith(`journey-${a}-`)
      || base.startsWith(`treinamento-${a}-`)
      || base.startsWith(`treinamento-jornada-${a}-`);
  });
}

export function QaWavesDocsTab({ domainId = null }) {
  const [activeType, setActiveType] = useState('roteiros');
  const [files, setFiles] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [loading, setLoading] = useState(false);

  const visibleFiles = useMemo(() => {
    if (!domainId) return files;
    return files.filter((file) => isDocForDomain(file.name, domainId));
  }, [files, domainId]);

  useEffect(() => {
    setSelectedDoc(null);
  }, [domainId]);

  const loadFiles = useCallback(async (type) => {
    setLoading(true);
    setSelectedDoc(null);
    try {
      const data = await fetchJson(`/api/qa-waves/docs/${type}`);
      setFiles(data.files || []);
    } catch (_) {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDoc = useCallback(async (type, name) => {
    setLoading(true);
    try {
      const data = await fetchJson(`/api/qa-waves/docs/${type}?name=${encodeURIComponent(name)}`);
      setSelectedDoc(data);
    } catch (_) {
      setSelectedDoc(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles(activeType);
  }, [activeType, loadFiles]);

  // Simple markdown → HTML renderer (handles headers, code blocks, tables, bold, lists)
  function renderMarkdown(content) {
    if (!content) return '';
    let html = content
      // Mermaid blocks → placeholder
      .replace(/```mermaid\n([\s\S]+?)```/g, (_m, code) =>
        `<div class="mermaid-block" style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;margin:12px 0;overflow-x:auto;font-family:monospace;font-size:12px;white-space:pre-wrap;">${escapeHtml(code.trim())}</div>`)
      // Code blocks
      .replace(/```(\w*)\n([\s\S]+?)```/g, (_m, lang, code) =>
        `<pre style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:8px;margin:8px 0;overflow-x:auto;font-size:12px;"><code>${escapeHtml(code.trim())}</code></pre>`)
      // Headers
      .replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 8px;font-size:15px;">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="margin:20px 0 10px;font-size:18px;border-bottom:1px solid var(--color-border-default);padding-bottom:4px;">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="margin:24px 0 12px;font-size:22px;">$1</h1>')
      // Tables
      .replace(/^\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/gm, (_m, header, rows) => {
        const hcells = header.split('|').map(c => `<th style="padding:4px 8px;border:1px solid var(--color-border-default);text-align:left;">${c.trim()}</th>`).join('');
        const rrows = rows.trim().split('\n').map(r =>
          '<tr>' + r.split('|').filter(c => c.trim()).map(c => `<td style="padding:4px 8px;border:1px solid var(--color-border-default);">${c.trim()}</td>`).join('') + '</tr>'
        ).join('');
        return `<table style="border-collapse:collapse;margin:8px 0;width:100%;font-size:13px;"><thead><tr>${hcells}</tr></thead><tbody>${rrows}</tbody></table>`;
      })
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code style="background:var(--color-bg-secondary);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>')
      // Lists
      .replace(/^- (.+)$/gm, '<li style="margin:2px 0;">$1</li>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p style="margin:8px 0;line-height:1.6;">')
      // Line breaks
      .replace(/\n/g, '<br/>');
    return '<p style="margin:8px 0;line-height:1.6;">' + html + '</p>';
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--color-border-default)', paddingBottom: 8 }}>
        {['roteiros', 'diagrams'].map(type => (
          <button
            key={type}
            onClick={() => { setActiveType(type); setFiles([]); }}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              background: activeType === type ? 'var(--color-bg-elevated)' : 'transparent',
              color: activeType === type ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: activeType === type ? 700 : 400,
              cursor: 'pointer',
              borderBottom: activeType === type ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
            }}
          >
            {type === 'roteiros' ? '📝 Roteiros' : '📊 Diagramas'} ({visibleFiles.length})
          </button>
        ))}
      </div>

      {loading && <p className="text-xs text-muted">Carregando...</p>}

      {/* ── File list ── */}
      {!selectedDoc && !loading && visibleFiles.length === 0 && (
        <p className="text-xs text-muted">Nenhum documento para este domínio.</p>
      )}

      {!selectedDoc && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visibleFiles.map(f => (
            <button
              key={f.name}
              onClick={() => loadDoc(activeType, f.name)}
              style={{
                textAlign: 'left',
                padding: '8px 12px',
                border: '1px solid var(--color-border-default)',
                borderRadius: 6,
                background: 'var(--color-bg-elevated)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {f.name.replace('.md', '').replace(/^jornada-/, '').replace(/^vertical-/, '📊 ').replace(/^architecture-/, '🏛️ ').replace(/^journey-/, '🔄 ').replace(/-/g, ' / ')}
            </button>
          ))}
        </div>
      )}

      {/* ── Doc content ── */}
      {selectedDoc && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <button onClick={() => setSelectedDoc(null)} style={{ fontSize: 12 }}>
              ← Voltar
            </button>
            <span className="text-xs text-muted">{selectedDoc.name}</span>
          </div>
          <div
            className="qa-waves-docs-content"
            style={{
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border-default)',
              borderRadius: 8,
              padding: 24,
              maxHeight: '70vh',
              overflow: 'auto',
              fontSize: 14,
              lineHeight: 1.7,
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedDoc.content) }}
          />
        </div>
      )}
    </div>
  );
}
