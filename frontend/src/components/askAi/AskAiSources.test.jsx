import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AskAiSources from './AskAiSources';

/**
 * TAREFA 21/22/30/31/32/33/34/46 — prova de render das fontes do Ask AI.
 *
 * RED (2026-09-14): `AskAiWidget.jsx:188-189` renderizava as fontes como TEXTO
 * (`<li>{source.title || source.label || source.id || source.chunkId ||
 * source.documentId}</li>`), sem link, com risco de imprimir identificador
 * interno. Nenhum teste de frontend cobria esse render.
 */

describe('AskAiSources — toda fonte visível é um link', () => {
  it('renderiza cada fonte como link clicável com rótulo humano', () => {
    render(
      <AskAiSources
        sources={[
          {
            sourceType: 'KNOWLEDGE_DOCUMENT',
            label: 'Manual de Matrícula',
            url: '/rag-documents?documentId=manual-matricula',
          },
        ]}
      />
    );
    const link = screen.getByTestId('ask-ai-source-link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/rag-documents?documentId=manual-matricula');
    expect(link.textContent).toBe('Manual de Matrícula');
  });

  it('link externo abre em nova aba com noopener noreferrer', () => {
    render(
      <AskAiSources
        sources={[{ sourceType: 'EXTERNAL', label: 'Documentação oficial', url: 'https://evo.com/docs' }]}
      />
    );
    const link = screen.getByTestId('ask-ai-source-link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('descarta fonte com URL insegura (nada de javascript:/data:/file:)', () => {
    render(
      <AskAiSources
        sources={[
          { label: 'Perigosa', url: 'javascript:alert(1)' },
          { label: 'Dados', url: 'data:text/html,<script>1</script>' },
          { label: 'Arquivo', url: 'file:///etc/passwd' },
          { label: 'Caminho', url: 'docs/roteiros/x.md' },
          { label: 'Segura', url: '/rag-documents?documentId=ok' },
        ]}
      />
    );
    const links = screen.getAllByTestId('ask-ai-source-link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/rag-documents?documentId=ok');
  });

  it('sem fonte segura não renderiza a seção', () => {
    const { container } = render(<AskAiSources sources={[{ label: 'x', url: 'javascript:1' }]} />);
    expect(screen.queryByTestId('ask-ai-sources')).toBeNull();
    expect(container.textContent).not.toContain('Fontes');
  });

  it('nunca renderiza identificador técnico (TAREFA 46)', () => {
    render(
      <AskAiSources
        sources={[
          {
            sourceType: 'KNOWLEDGE_DOCUMENT',
            label: 'Chunk 15',
            url: '/rag-documents?documentId=src-docs-manual-verticals-beauty-html',
          },
          { label: 'src-docs-roteiros-x-md', url: '/rag-documents?documentId=src-docs-roteiros-x-md' },
        ]}
      />
    );
    const texto = document.body.textContent;
    expect(texto).not.toMatch(/^chunk\s+\d+/i);
    expect(texto).not.toContain('src-docs-');
    expect(texto).not.toContain('chunkId');
    expect(texto).not.toContain('score');
    // rótulo derivado do identificador da URL
    expect(screen.getAllByTestId('ask-ai-source-link')[0].textContent).toBe('Manual Verticals Beauty');
  });

  it('deduplica a mesma fonte repetida em vários chunks (TAREFA 34)', () => {
    render(
      <AskAiSources
        sources={[
          { label: 'Manual', url: '/rag-documents?documentId=1' },
          { label: 'Manual (outro trecho)', url: '/rag-documents?documentId=1' },
        ]}
      />
    );
    expect(screen.getAllByTestId('ask-ai-source-link')).toHaveLength(1);
  });
});
