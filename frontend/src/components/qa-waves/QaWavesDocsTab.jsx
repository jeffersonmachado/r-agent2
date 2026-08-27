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

/**
 * Parseia o subconjunto de Mermaid usado nos diagramas gerados
 * (`flowchart TD` / `flowchart LR` com nós e arestas `-->`).
 */
function parseMermaidFlow(source) {
  if (!source) return null;
  const lines = String(source).split('\n');
  let direction = 'TD';
  const nodeMap = new Map();
  const edges = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const dirMatch = line.match(/^flowchart\s+(TD|TB|LR|RL|BT)\b/i);
    if (dirMatch) { direction = dirMatch[1].toUpperCase(); continue; }
    if (/^(%%|classDef\b|style\b|linkStyle\b)/.test(line)) continue;

    const nodeMatch = line.match(/^([\w.-]+)\s*(\[[\s\S]*\]|\{[\s\S]*\}|\([\s\S]*\)|>[\s\S]*\])$/);
    if (nodeMatch) {
      const id = nodeMatch[1];
      const rawLabel = nodeMatch[2].slice(1, -1).replace(/^["']|["']$/g, '').trim();
      nodeMap.set(id, { id, label: rawLabel.replace(/\\n/g, '\n') });
      continue;
    }

    const edgeMatch = line.match(/^([\w.-]+)\s*-->(.*)$/);
    if (edgeMatch) {
      const from = edgeMatch[1];
      const rest = edgeMatch[2].trim();
      let to = rest;
      if (rest.startsWith('|')) {
        const parts = rest.split('|');
        to = (parts[2] || '').trim();
      }
      edges.push({ from, to });
    }
  }

  if (nodeMap.size === 0) return null;

  const children = new Map();
  const indegree = new Map();
  for (const id of nodeMap.keys()) { children.set(id, []); indegree.set(id, 0); }
  for (const e of edges) {
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
    children.get(e.from).push(e.to);
    indegree.set(e.to, indegree.get(e.to) + 1);
  }

  const roots = [...nodeMap.keys()].filter((id) => indegree.get(id) === 0);
  const levelOf = new Map();
  const queue = roots.map((r) => [r, 0]);
  const visited = new Set();
  while (queue.length) {
    const [id, lvl] = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    levelOf.set(id, lvl);
    for (const child of children.get(id) || []) {
      if (!visited.has(child)) queue.push([child, lvl + 1]);
    }
  }
  const maxLevel = levelOf.size ? Math.max(...levelOf.values()) : 0;
  for (const id of nodeMap.keys()) if (!levelOf.has(id)) levelOf.set(id, maxLevel + 1);

  const grouped = new Map();
  for (const [id, lvl] of levelOf) {
    if (!grouped.has(lvl)) grouped.set(lvl, []);
    grouped.get(lvl).push(id);
  }
  const levels = [...grouped.keys()].sort((a, b) => a - b)
    .map((lvl) => grouped.get(lvl).map((id) => nodeMap.get(id)));

  return { levels, direction };
}

function MermaidFlow({ source }) {
  const graph = useMemo(() => parseMermaidFlow(source), [source]);
  if (!graph) {
    return <pre className="qa-mermaid-fallback">{source}</pre>;
  }
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
  return (
    <div className={`qa-mermaid-flow${horizontal ? ' qa-mermaid-flow--horizontal' : ''}`}>
      {graph.levels.map((levelNodes, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <div className="qa-mermaid-arrow">{horizontal ? '→' : '↓'}</div>}
          <div className="qa-mermaid-level">
            {levelNodes.map((n) => (
              <div key={n.id} className="qa-mermaid-node">
                {n.label.split('\n').map((line, i) => (
                  <div key={i}>{line || '\u00A0'}</div>
                ))}
              </div>
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function extractDocSegments(content) {
  const segments = [];
  const regex = /```mermaid\n([\s\S]+?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'md', content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'mermaid', content: match[1] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'md', content: content.slice(lastIndex) });
  }
  return segments;
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
      // Remove YAML frontmatter (--- ... ---)
      .replace(/^---\n[\s\S]*?\n---\n?/, '')
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
          >
            {extractDocSegments(selectedDoc.content).map((segment, index) => {
              if (segment.type === 'mermaid') {
                return <MermaidFlow key={index} source={segment.content} />;
              }
              return (
                <div
                  key={index}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.content) }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
