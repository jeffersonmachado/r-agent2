import { describe, it, expect } from 'vitest';
import { sanitizeSourceUrl, sanitizeSourceLinks, SOURCE_URL_MAX_LENGTH } from './urlSafety';

/**
 * TAREFA 32/33/94 — Sanitização de URL de fonte do Ask AI.
 *
 * RED (2026-09-14): não existia NENHUM utilitário de sanitização de URL em
 * `frontend/src` (auditoria: o padrão é `window.open(url, '_blank', 'noopener')`
 * duplicado em ~14 arquivos, e `RagDocumentDetailsModal.jsx:149-153` monta `<a
 * href>` de dado de documento sem allowlist de scheme). Quando o Ask AI passou a
 * linkar fontes, ficou sem barreira contra `javascript:`, `data:`, `file:` e
 * caminhos internos de filesystem.
 *
 * Contrato: só passa (a) caminho interno absoluto do RAP (`/rota`) e (b) http(s)
 * absoluto. Tudo mais → null (fonte não é renderizada como link).
 */

describe('sanitizeSourceUrl — allowlist de scheme e de origem', () => {
  it('aceita caminho interno absoluto do RAP', () => {
    expect(sanitizeSourceUrl('/rag-documents?documentId=abc')).toBe('/rag-documents?documentId=abc');
    expect(sanitizeSourceUrl('/knowledge-base/manuais/12')).toBe('/knowledge-base/manuais/12');
  });

  it('aceita http e https absolutos', () => {
    expect(sanitizeSourceUrl('https://evo.com/docs')).toBe('https://evo.com/docs');
    expect(sanitizeSourceUrl('http://127.0.0.1:8001/doc')).toBe('http://127.0.0.1:8001/doc');
  });

  it('rejeita schemes perigosos', () => {
    expect(sanitizeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeSourceUrl('JavaScript:alert(1)')).toBeNull();
    expect(sanitizeSourceUrl('  javascript:alert(1)')).toBeNull();
    expect(sanitizeSourceUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(sanitizeSourceUrl('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeSourceUrl('blob:https://x/y')).toBeNull();
  });

  it('rejeita file:// e caminhos de filesystem (TAREFA 94)', () => {
    expect(sanitizeSourceUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeSourceUrl('docs/roteiros/jornada-fitness-renovacao.md')).toBeNull();
    expect(sanitizeSourceUrl('/srv/app/docs/manual.md')).toBeNull();
    expect(sanitizeSourceUrl('/var/lib/ragent2/replay/x.json')).toBeNull();
    expect(sanitizeSourceUrl('/opt/results/ria/r-agent2/docs/x.md')).toBeNull();
    expect(sanitizeSourceUrl('C:\\docs\\manual.md')).toBeNull();
  });

  it('rejeita protocol-relative e caminho relativo simples', () => {
    expect(sanitizeSourceUrl('//evil.example.com/x')).toBeNull();
    expect(sanitizeSourceUrl('docs/manual.html')).toBeNull();
  });

  it('rejeita entradas vazias ou não-string', () => {
    expect(sanitizeSourceUrl('')).toBeNull();
    expect(sanitizeSourceUrl('   ')).toBeNull();
    expect(sanitizeSourceUrl(null)).toBeNull();
    expect(sanitizeSourceUrl(undefined)).toBeNull();
    expect(sanitizeSourceUrl(42)).toBeNull();
  });

  it('rejeita URL acima do limite de tamanho', () => {
    const longa = `https://exemplo.com/${'a'.repeat(SOURCE_URL_MAX_LENGTH)}`;
    expect(sanitizeSourceUrl(longa)).toBeNull();
  });
});

describe('sanitizeSourceLinks — normalização da lista de fontes', () => {
  it('descarta fontes sem url segura e nunca deixa id técnico vazar', () => {
    const links = sanitizeSourceLinks([
      { label: 'Manual', url: '/rag-documents?documentId=1', sourceType: 'KNOWLEDGE_DOCUMENT' },
      { label: 'Perigosa', url: 'javascript:alert(1)', sourceType: 'KNOWLEDGE_DOCUMENT' },
      { label: 'Caminho', url: 'docs/x.md', sourceType: 'KNOWLEDGE_DOCUMENT' },
      { label: 'Sem url', sourceType: 'OPERATIONAL_DATA' },
    ]);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('/rag-documents?documentId=1');
  });

  it('deduplica a mesma fonte repetida (TAREFA 34)', () => {
    const links = sanitizeSourceLinks([
      { label: 'Manual', url: '/rag-documents?documentId=1' },
      { label: 'Manual (outro chunk)', url: '/rag-documents?documentId=1' },
      { label: 'Outro', url: '/rag-documents?documentId=2' },
    ]);
    expect(links).toHaveLength(2);
  });

  it('atribui rótulo de fallback humano quando o label falta', () => {
    const links = sanitizeSourceLinks([{ url: '/rag-documents?documentId=1' }]);
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe('Fonte consultada');
  });

  it('não aceita rótulo que seja caminho ou id técnico', () => {
    const links = sanitizeSourceLinks([
      { label: 'docs/roteiros/x.md', url: '/rag-documents?documentId=1' },
      { label: 'src-docs-roteiros-x-md', url: '/rag-documents?documentId=2' },
      { label: 'Chunk 15', url: '/rag-documents?documentId=3' },
    ]);
    for (const link of links) {
      expect(link.label).not.toMatch(/\.md$|^src-docs-|^chunk\s+\d+/i);
    }
  });
});
