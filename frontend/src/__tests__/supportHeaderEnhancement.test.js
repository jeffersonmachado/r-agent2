import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enhanceSupportHeaders } from '../utils/supportHeaderEnhancement';

/**
 * REGRESSÃO do erro crítico medido em 2026-10-14.
 *
 * O QA Mesh reprovou o cenário `support-inbox-nota-ui` (omnichannel, blocking) com:
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node':
 *     The node to be removed is not a child of this node.
 *   at removeChildFromContainer (React DOM)
 *   at commitDeletionEffectsOnFiber (React DOM)
 *
 * `removeChild` apareceu 20× naquele relatório e ZERO vezes nos 10 meshes
 * anteriores. A causa era o enhancement do header: ele MOÍA os filhos do `<h1>`
 * (que pertencem ao React) para um `<span>` e depois chamava
 * `title.replaceChildren(...)`. Com a árvore de fibers inconsistente, o commit
 * seguinte do React tentava remover nós que já não eram filhos.
 *
 * O teste 1 abaixo é o que FALHA no código anterior: os nós originais deixavam de
 * ser filhos do `<h1>`.
 */

function montarHeader() {
  document.body.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'support-header';
  const h1 = document.createElement('h1');
  const filho1 = document.createElement('span');
  filho1.textContent = 'Central de Atendimento';
  const filho2 = document.createElement('em');
  filho2.textContent = 'segmento';
  h1.append(filho1, filho2);
  header.appendChild(h1);
  document.body.appendChild(header);
  return { header, h1, filho1, filho2 };
}

describe('enhanceSupportHeaders — não pode manipular nós gerenciados pelo React', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('DEFEITO: preserva os filhos do <h1> (mesmos nós e ainda filhos) — antes eram movidos/substituídos', () => {
    const { h1, filho1, filho2 } = montarHeader();

    enhanceSupportHeaders({ navigate: () => {}, currentPath: '/support' });

    // Se o enhancement mover/substituir os filhos, o React perde a referência e o
    // commit seguinte estoura com removeChild. Este é o coração da regressão.
    expect(h1.children).toHaveLength(2);
    expect(h1.children[0]).toBe(filho1);
    expect(h1.children[1]).toBe(filho2);
    expect(filho1.parentElement).toBe(h1);
    expect(filho2.parentElement).toBe(h1);
    expect(h1.textContent).toContain('Central de Atendimento');
    expect(h1.textContent).toContain('segmento');
  });

  it('injeta o botão de voltar como IRMÃO do título, nunca dentro do <h1>', () => {
    const { header, h1 } = montarHeader();

    enhanceSupportHeaders({ navigate: () => {}, currentPath: '/support' });

    const botao = header.querySelector('.support-back-button');
    expect(botao).toBeTruthy();
    expect(botao.parentElement).toBe(header);
    expect(botao.nextElementSibling).toBe(h1);
    expect(h1.querySelector('.support-back-button')).toBeNull();
    expect(header.classList.contains('support-header-with-back')).toBe(true);
  });

  it('não duplica o botão em chamadas repetidas (guarda olha o header, não o <h1>)', () => {
    const { header } = montarHeader();

    enhanceSupportHeaders({ navigate: () => {}, currentPath: '/support' });
    enhanceSupportHeaders({ navigate: () => {}, currentPath: '/support' });
    enhanceSupportHeaders({ navigate: () => {}, currentPath: '/support' });

    expect(header.querySelectorAll('.support-back-button')).toHaveLength(1);
  });

  it('o clique tem fallback determinístico: sem histórico, chama navigate no path canônico', () => {
    // Em jsdom `window.history.length` não é > 1, então este é o caminho exercitado
    // (o ramo `history.back()` depende do histórico real do browser e é coberto na
    // jornada de navegação, não aqui).
    const { header } = montarHeader();
    const navigate = vi.fn();

    enhanceSupportHeaders({ navigate, currentPath: '/support' });
    header.querySelector('.support-back-button').click();

    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('currentPath /dashboard volta para /workspace', () => {
    const { header } = montarHeader();
    const navigate = vi.fn();

    enhanceSupportHeaders({ navigate, currentPath: '/dashboard' });
    header.querySelector('.support-back-button').click();

    expect(navigate).toHaveBeenCalledWith('/workspace');
  });

  it('sem header aplicável, não quebra e devolve 0', () => {
    document.body.innerHTML = '<div class="outra-classe"></div>';
    expect(enhanceSupportHeaders({})).toBe(0);
  });
});
