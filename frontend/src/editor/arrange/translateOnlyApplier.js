/**
 * Helpers para auto-arrange sem resize.
 *
 * Problema: o `rete-auto-arrange-plugin` usa `StandardApplier`, que chama `area.resize(...)`.
 * O `rete-area-plugin` então aplica `style.width/style.height` no primeiro filho "útil" do NodeView,
 * o que no nosso caso costuma atingir `.flow-node` e quebra o layout interno (texto/sockets).
 *
 * Solução: usar um applier customizado que só faz translate (reposiciona), sem resize,
 * e limpar `width/height` inline já aplicados.
 */

/**
 * Cria um applier compatível com `rete-auto-arrange-plugin` que aplica apenas translate.
 * O plugin chama `applier.setEditor(...)`, `applier.setArea(...)` e `applier.apply(result.children)`.
 */
export function createTranslateOnlyApplier() {
  /** @type {any} */
  const applier = {
    editor: null,
    area: null,
    setEditor(editor) {
      this.editor = editor;
    },
    setArea(area) {
      this.area = area;
    },
    /**
     * @param {Array<any>} nodes ELK nodes (result.children)
     * @param {{x:number,y:number}} [offset]
     */
    async apply(nodes, offset = { x: 0, y: 0 }) {
      const area = this.area;
      if (!area || !area.nodeViews) return;

      // Filtra shapes válidos (best-effort)
      const valid = (Array.isArray(nodes) ? nodes : []).filter((n) => {
        const x = n?.x;
        const y = n?.y;
        // width/height podem existir no resultado, mas aqui não usamos
        return typeof x !== 'undefined' && typeof y !== 'undefined';
      });

      await Promise.all(
        valid.map(async (n) => {
          const id = n?.id;
          const x = Number(n?.x);
          const y = Number(n?.y);
          if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return;

          const view = area.nodeViews.get(id);
          if (view && typeof view.translate === 'function') {
            try {
              await view.translate(offset.x + x, offset.y + y);
            } catch {
              // best-effort
            }
          }

          // Recursão para children (scopes / nested)
          if (Array.isArray(n?.children) && n.children.length > 0) {
            await this.apply(n.children, { x: offset.x + x, y: offset.y + y });
          }
        }),
      );
    },
  };

  return applier;
}

/**
 * Remove `width/height` inline aplicados no elemento real do nó (ex.: `.flow-node`).
 * @param {any} area `rete-area-plugin` area
 * @param {Array<any>} nodes lista de nós do editor
 */
export function cleanupInlineNodeSize(area, nodes) {
  try {
    if (!area?.nodeViews || !Array.isArray(nodes)) return;

    nodes.forEach((n) => {
      try {
        const nodeId = n?.id;
        const view = area.nodeViews.get(nodeId);
        const wrapper = view?.element;
        if (!wrapper || !(wrapper instanceof HTMLElement)) return;

        // Preferência: limpar diretamente no `.flow-node` (nosso root visual)
        const flowNodeEl = wrapper.querySelector('.flow-node');
        const target =
          (flowNodeEl instanceof HTMLElement && flowNodeEl) ||
          wrapper.querySelector('*:not(span):not([fragment])') ||
          wrapper.firstElementChild ||
          wrapper;

        if (!(target instanceof HTMLElement)) return;

        if (target.style?.width) target.style.width = '';
        if (target.style?.height) target.style.height = '';
      } catch {
        // best-effort
      }
    });
  } catch {
    // best-effort
  }
}

