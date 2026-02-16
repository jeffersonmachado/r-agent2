# Analise de JS por HTML com jqGrid

## Escopo analisado
- Base: `remote-dumps2/extracted/ripabx-web-html-app/app`
- HTMLs com jqGrid detectados: 14

## Matriz HTML -> JS -> comportamento jqGrid
| HTML | JS analisados | Onde o jqGrid e inicializado | Fonte de dados / endpoint | Observacoes |
|---|---|---|---|---|
| `faxweb.html` | (sem JS de tela dedicado; apenas libs) | Inline no proprio HTML (`#west-grid`) | `menu_fax.xml` | TreeGrid de menu lateral; abre paginas em abas com `$(tab).load(url)` |
| `menu.html` | (sem JS de tela dedicado; apenas libs) | Inline no proprio HTML (`#west-grid`) | `tree.xml` | TreeGrid de menu lateral; abre paginas em abas |
| `index2.html` | `grid_par.js` (carregado, mas nao usado no menu lateral) | Inline no proprio HTML (`#west-grid`) | `xml2.php?xml=menu.xml` | TreeGrid de menu lateral; carrega telas por `load(url)` |
| `index_cc.html` | `grid_par.js` (carregado, mas nao usado no menu lateral) | Inline no proprio HTML (`#west-grid`) | `xml2.php?xml=menu_cc.xml` | Mesmo padrao do `index2.html` |
| `indexteste.html` | (sem JS de tela dedicado; apenas libs) | Inline no proprio HTML (`#west-grid`) | `menu.xml` | Mesmo padrao de menu/arvore |
| `teste_tree.html` | (sem JS de tela dedicado) | Inline no proprio HTML (`#tree`) | `data.json` | Exemplo de TreeGrid em JSON (`treeGridModel: nested`) |
| `index.html` | `grid_par.js`, `js/ripabx.js`, `js/flow_ura.js` | Nao ha `jqGrid(...)` inline no arquivo | N/A (shell de carregamento) | Carrega libs jqGrid e o shell principal; telas de grid entram via menu/abas |
| `index3.html` | `grid_par.js` | Nao ha `jqGrid(...)` inline no arquivo | N/A (shell de carregamento) | Carrega libs jqGrid; sem inicializacao direta no HTML |
| `tron_clientes.html` | `tron_clientes.js`, `tron_servicos.js`, `tron_palavras_base.js`, `tron_substitutos.js`, `js/jqgrid_odata.js` | Via funcao `jqgrid_odata()` nos JS `tron_*` | OData (`/odata-tron/api/...`) | Tela composta: 4 grids na mesma pagina |
| `tron_dicionario.html` | `tron_dicionario.js`, `js/jqgrid_odata.js` | Via `jqgrid_odata()` | OData (`/odata-tron/api/dicionario`) | ColModel grande com campos lexicais |
| `tron_palavras_base.html` | `tron_palavras_base.js`, `js/jqgrid_odata.js` | Via `jqgrid_odata()` | OData (`/odata-tron/api/palavras_base`) | Grid simples (cliente/servico/palavra base) |
| `tron_palavras_sinonimos.html` | `tron_palavras_sinonimos.js`, `js/jqgrid_odata.js` | Via `jqgrid_odata()` | OData (`/odata-tron/api/palavras_sinonimos`) | Grid de sinonimos por palavra base |
| `tron_substituidos.html` | `tron_substituidos.js`, `js/jqgrid_odata.js` | Via `jqgrid_odata()` | OData (`/odata-tron/api/substituidos`) | Grid de frases substituidas |
| `tron_substitutos.html` | `tron_substitutos.js`, `js/jqgrid_odata.js` | Via `jqgrid_odata()` | OData (`/odata-tron/api/substitutos`) | Grid de frases base por cliente/servico |

## Analise dos JS de configuracao de grid

### `grid_par.js`
- Nao cria grid; aplica comportamento comum em grids ja existentes:
  - `navGrid` (editar/adicionar/excluir)
  - `filterToolbar`
  - `reloadGrid` apos submit
- Sanitiza `postdata.codigo` trocando caracteres especiais por `_`.
- Ajustes por id de grid:
  - muda `width` de formulario
  - define `datatype = "json"` para alguns grids especificos (`#users`, `#hosts`, `#usuarios`, `#memorias`, `#regras`, `#objetivos`, `#rchatbot`, etc.)
- Possui regra especial para `#ramais` chamando `app/gera_avaya.php` apos edicao.

### `tron_*.js` (cliente, servicos, dicionario, palavras, substituicoes)
- Todos seguem o mesmo padrao:
  - definem variaveis globais (`tabela`, `grid`, `pager`, `chave`, `titulo`, `metadataurl`, `url`)
  - definem `colModelDefinition`
  - chamam `jqgrid_odata()`
  - chamam `grid_par(grid, pager)`
- Endpoints OData montados com host atual:
  - `http://<hostname>/odata-tron/api/clientes`
  - `http://<hostname>/odata-tron/api/servicos`
  - `http://<hostname>/odata-tron/api/dicionario`
  - `http://<hostname>/odata-tron/api/palavras_base`
  - `http://<hostname>/odata-tron/api/palavras_sinonimos`
  - `http://<hostname>/odata-tron/api/substituidos`
  - `http://<hostname>/odata-tron/api/substitutos`

### JS carregados sem configuracao direta de jqGrid
- `js/ripabx.js`: utilitarios de navegacao/parametros.
- `js/flow_ura.js`: fluxo/diagramacao URA (JSON), sem `jqGrid(...)`.

## Pontos de atencao encontrados
- Arquivo referenciado e nao encontrado no dump:
  - `js/jqgrid_odata.js`
- Arquivos referenciados em `index.html` e nao encontrados no dump:
  - `jqGrid/plugins/grid.odata.js`
  - `jqGrid/plugins/jquery.jqGrid.draggableTree.js`
- `index.html` referencia `js/main.js`, tambem ausente no dump.
- Sem `jqgrid_odata.js`, a inicializacao dos grids `tron_*` fica incompleta no ambiente extraido.
