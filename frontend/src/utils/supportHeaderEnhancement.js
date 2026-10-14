/**
 * Enhancement imperativo dos headers de Atendimento (`.support-header`).
 *
 * DEFEITO MEDIDO em 2026-10-14 — a versão anterior fazia:
 *
 *   while (title.firstChild) titleContent.appendChild(title.firstChild);
 *   title.replaceChildren(backButton, titleContent);
 *
 * Os filhos do `<h1>` PERTENCEM ao React. Movê-los para um `<span>` novo e depois
 * substituir a subárvore inteira deixava a árvore de fibers apontando para nós que
 * já não eram filhos. No commit seguinte — re-render ou desmontagem, como a troca
 * de rota — o React chamava `removeChild` num nó inexistente:
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node':
 *     The node to be removed is not a child of this node.
 *   at removeChildFromContainer (React DOM)
 *   at commitDeletionEffectsOnFiber (React DOM)
 *
 * Foi o erro crítico que reprovou o cenário `support-inbox-nota-ui` (omnichannel,
 * blocking) no QA Mesh: 144 cenários, 143 passaram, `removeChild` apareceu 20×
 * naquele relatório e ZERO vezes nos 10 meshes anteriores.
 *
 * REGRA: em nó gerenciado pelo React, é seguro ADICIONAR um irmão; NÃO é seguro
 * mover, substituir ou remover nós que o React conhece. Por isso o botão entra como
 * IRMÃO do `<h1>` (`header.insertBefore`) e o layout fica no CSS
 * (`.support-header-with-back`). Os filhos do título permanecem intactos.
 *
 * @param {{navigate?: Function, currentPath?: string}} [options]
 * @returns {number} quantidade de headers que receberam o botão nesta chamada
 */
function enhanceSupportHeaders({ navigate, currentPath } = {}) {
  const headers = Array.from(document.querySelectorAll('.support-header'));
  let aplicados = 0;

  for (const header of headers) {
    if (!(header instanceof HTMLElement)) continue;
    const title = header.querySelector('h1');
    if (!(title instanceof HTMLElement)) continue;
    // A guarda olha o BOTÃO NO HEADER: ele passou a ser irmão do título, então
    // procurá-lo dentro do `<h1>` nunca encontraria nada e o botão seria duplicado.
    if (header.querySelector('.support-back-button')) continue;

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'support-back-button';
    backButton.textContent = '<';
    backButton.setAttribute('aria-label', 'Voltar para a pagina anterior');
    backButton.title = 'Voltar';
    backButton.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      if (typeof navigate === 'function') {
        navigate(currentPath === '/dashboard' ? '/workspace' : '/dashboard');
      }
    });

    header.insertBefore(backButton, title);
    header.classList.add('support-header-with-back');
    aplicados += 1;
  }

  return aplicados;
}

export { enhanceSupportHeaders };
