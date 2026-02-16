# Referencia De Funcionalidades (R-IPABX / RIPABX)

Este documento lista as funcionalidades/telas existentes no **R-IPABX (RIPABX)** com base no menu atual/legado, para servir como checklist de paridade quando evoluir/modernizar a interface.

Fontes (dump do servidor):
- `remote-dumps/ripabx-web-all-php/html/menu2.php` (menu estilo "sidebar", usado no `ripabx-web`)
- `remote-dumps/ripabx-web-all-php/html/menu.php` (menu legado "nav-md"; tem itens extras)

## Menu (menu2.php) - Baseline Principal

### Principal

| Grupo | Item | Link (path) | Permissao |
| --- | --- | --- | --- |
| Principal | Inicio | `dash.html` | (sem wrapper) |
| Dashbords | Painel | `app/painel.html` | `R` |
| Manutencao | DDR | `app/ddr.html` | `C` |
| Manutencao | Grupos | `app/grupo.html` | `C` |
| Manutencao | Ramais | `app/ramais.html` | `C` |
| Manutencao | Desvio | `app/desvio.html` | `C` |
| Manutencao | Transbordo | `app/transbordo.html` | `C` |
| Manutencao | Bloqueio | `app/bloqueio.html` | `C` |
| Manutencao | Retorno | `app/retorno.html` | `C` |
| Manutencao | Recusa | `app/recusa.html` | `C` |
| Manutencao | Feriado | `app/feriado.html` | `C` |
| Manutencao | Transferencia | `app/transferencia.html` | `C` |
| Audios | Espera | `app/upload.html?dir=espera` | `R` |
| Audios | Sons | `app/upload.html?dir=sons` | `R` |
| Relatorios | Ligacoes | `app/cdr.html` | `R` |
| Relatorios | Fax | `app/fax_rel.html` | `R` |
| Relatorios | Gravacoes | `app/sac.html` | `R` |
| Relatorios | Resumo | `app/resumo.html` | `R` |
| Relatorios | Hora | `app/hora.html` | `R` |
| Relatorios | Origem | `app/origem.html` | `R` |
| Relatorios | Destino | `app/destino.html` | `R` |
| Configuracoes | Configuracoes | `app/configuracoes.html` | `C` |
| Configuracoes | Operadoras | `app/operadoras.html` | `C` |
| Configuracoes | Rotas | `app/rotas.html` | `C` |
| Configuracoes | Categoria | `app/categoria.html` | `C` |
| Configuracoes | Fax | `app/fax.html` | `C` |
| Configuracoes | Facilidades | `app/facilidades.html` | `C` |
| Configuracoes | URA | `app/ura.html` | `C` |
| Configuracoes | Sala | `app/sala.html` | `C` |
| Configuracoes | Interconexao | `app/interconexao.html` | `C` |
| Configuracoes | Usuarios | `app/usuarios.html` | `C` |
| Configuracoes | Rede | `config/net` | `C` |
| Configuracoes | DHCP | `config/dhcpd` | `C` |
| Configuracoes | Firewall | `config/firewalld` | `C` |
| Configuracoes | VPN | `config/ipsec` | `C` |
| Configuracoes | Licenca | `app/licenca.php` | `C` |
| Configuracoes | Atualizacao | `app/update.php` | `C` |
| Configuracoes | Assistencia | `/cgi/ripabx/assistencia.cgi` | `C` |
| Configuracoes | Recarga | `app/recarga.php` | `C` |

### Contact Center

| Grupo | Item | Link (path) | Permissao |
| --- | --- | --- | --- |
| Manutencao | Fila | `app/fila.html` | `C` |
| Manutencao | Motivo Pausa | `app/motivo.html` | `C` |
| Manutencao | Motivo Contato | `app/motivo1.html` | `C` |
| Manutencao | Campanhas | `app/campanha.html` | `C` |
| Manutencao | CallBack Agendado | `app/agendado.html` | `C` |
| Relatorios | atendidas | `app/fila_atendidas.html` | `R` |
| Relatorios | abandonadas | `app/fila_abandonadas.html` | `R` |
| Relatorios | agentes | `app/fila_agentes.html` | `R` |
| Relatorios | por hora | `app/fila_hora.html` | `R` |
| Relatorios | Resumo por campanha | `app/filas_resumo.html` | `R` |
| Relatorios | Pesquisa | `app/pesquisa.html` | `R` |
| Extras | Click2Call | `app/click2call.php` | `R` |

### Rfone

| Grupo | Item | Link (path) | Permissao |
| --- | --- | --- | --- |
| Download | Windows | `rfone/Rfone_Setup.exe` | (sem wrapper) |
| Download | Linux | `rfone/Rfone.bin` | (sem wrapper) |

## Mapa Tecnico Do Legado (evidencia para paridade)

Tabela derivada de `docs/RIPABX_WEB_MENU_MAP.json` (inventario do legado), limitada ao que esta no escopo do checklist.

| Item | href | Perm | arquivo (resolvido) | JS | xml.php (views) | server.php (writes) | server2.php (writes) | mysql*.php (reads/writes) | URA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Assistencia | `/cgi/ripabx/assistencia.cgi` | C | - | - | - | - | - | - | load=False, save=False |
| CallBack Agendado | `app/agendado.html` | C | agendado.html | agendado.js | fila.xml+fila2.xsl, fila.xml+fila3.xsl | - | agendado | agendado, agendado_detalhes | load=False, save=False |
| Bloqueio | `app/bloqueio.html` | C | bloqueio.html | bloqueio.js | bloqueio.xml+bloqueio.xsl | bloqueio | - | - | load=False, save=False |
| Campanhas | `app/campanha.html` | C | campanha.html | campanha.js | fila.xml+fila2.xsl, fila.xml+fila3.xsl | - | campanha | campanha | load=False, save=False |
| Categoria | `app/categoria.html` | C | categoria.html | categoria.js | tipo.xml+tipo2.xsl, rota_base.xml+rota2.xsl, categoria.xml+categoria.xsl | categoria | - | - | load=False, save=False |
| Ligacoes | `app/cdr.html` | R | cdr.html | cdr.js, exportagrid.js | - | - | - | - | load=False, save=False |
| Click2Call | `app/click2call.php` | R | click2call.php | - | - | - | - | - | load=False, save=False |
| Configuracoes | `app/configuracoes.html` | C | configuracoes.html | configuracoes.js | - | - | - | - | load=False, save=False |
| DDR | `app/ddr.html` | C | ddr.html | ddr.js | operadora.xml+operadora2.xsl, ddr.xml+ddr.xsl | ddr | - | - | load=False, save=False |
| Destino | `app/destino.html` | R | destino.html | destino.js | - | - | - | - | load=False, save=False |
| Desvio | `app/desvio.html` | C | desvio.html | desvio.js | desvio.xml+desvio.xsl | desvio | - | - | load=False, save=False |
| Facilidades | `app/facilidades.html` | C | facilidades.html | facilidades.js | - | - | - | - | load=False, save=False |
| Fax | `app/fax.html` | C | fax.html | fax.js | fax.xml+fax.xsl | fax | - | - | load=False, save=False |
| Fax | `app/fax_rel.html` | R | fax_rel.html | fax_rel.js | - | - | - | - | load=False, save=False |
| Feriado | `app/feriado.html` | C | feriado.html | feriado.js | feriado.xml+feriado.xsl | feriado | - | - | load=False, save=False |
| Fila | `app/fila.html` | C | fila.html | fila.js | fila.xml+fila.xsl | fila | - | - | load=False, save=False |
| abandonadas | `app/fila_abandonadas.html` | R | fila_abandonadas.html | fila_abandonadas.js | fila.xml+fila.xsl | - | - | - | load=False, save=False |
| agentes | `app/fila_agentes.html` | R | fila_agentes.html | fila_agentes.js | fila.xml+fila.xsl | - | - | - | load=False, save=False |
| atendidas | `app/fila_atendidas.html` | R | fila_atendidas.html | fila_atendidas.js | fila.xml+fila.xsl | - | - | - | load=False, save=False |
| por hora | `app/fila_hora.html` | R | fila_hora.html | fila_hora.js | fila.xml+fila.xsl | - | - | - | load=False, save=False |
| Resumo por campanha | `app/filas_resumo.html` | R | filas_resumo.html | filas_resumo.js | fila.xml+fila2.xsl, fila.xml+fila3.xsl | - | campanha | campanha, campanha_resumo | load=False, save=False |
| Grupos | `app/grupo.html` | C | grupo.html | grupo.js | grupo.xml+grupo.xsl | grupo | - | - | load=False, save=False |
| Hora | `app/hora.html` | R | hora.html | hora.js | - | - | - | - | load=False, save=False |
| Interconexao | `app/interconexao.html` | C | interconexao.html | interconexao.js | interconexao.xml+interconexao.xsl | interconexao | - | - | load=False, save=False |
| Licenca | `app/licenca.php` | C | licenca.php | - | - | - | - | - | load=False, save=False |
| Motivo Pausa | `app/motivo.html` | C | motivo.html | motivo.js | motivo.xml+motivo.xsl | motivo | - | - | load=False, save=False |
| Motivo Contato | `app/motivo1.html` | C | motivo1.html | motivo1.js | motivo1.xml+motivo1.xsl | motivo1 | - | - | load=False, save=False |
| Operadoras | `app/operadoras.html` | C | operadoras.html | operadoras.js | operadora.xml+operadora.xsl | operadora | - | - | load=False, save=False |
| Origem | `app/origem.html` | R | origem.html | origem.js | - | - | - | - | load=False, save=False |
| Painel | `app/painel.html` | R | painel.html | painel.js | - | - | - | - | load=False, save=False |
| Pesquisa | `app/pesquisa.html` | R | pesquisa.html | pesquisa.js | fila.xml+fila.xsl | - | - | - | load=False, save=False |
| Ramais | `app/ramais.html` | C | ramais.html | ramais.js | grupo.xml+grupo2.xsl, categoria.xml+categoria2.xsl, ramal.xml+ramal.xsl | ramal | - | - | load=False, save=False |
| Recarga | `app/recarga.php` | C | recarga.php | - | - | - | - | - | load=False, save=False |
| Recusa | `app/recusa.html` | C | recusa.html | recusa.js | recusa.xml+recusa.xsl | recusa | - | - | load=False, save=False |
| Resumo | `app/resumo.html` | R | resumo.html | resumo.js | - | - | - | - | load=False, save=False |
| Retorno | `app/retorno.html` | C | retorno.html | retorno.js | retorno.xml+retorno.xsl | retorno | - | - | load=False, save=False |
| Rotas | `app/rotas.html` | C | rotas.html | rotas.js | operadora.xml+operadora2.xsl, rota_base.xml+rota_base.xsl, rota.xml+rota.xsl | rota_base, rota | - | - | load=False, save=False |
| Gravacoes | `app/sac.html` | R | sac.html | sac.js | - | - | - | - | load=False, save=False |
| Sala | `app/sala.html` | C | sala.html | sala.js | sala.xml+sala.xsl | sala | - | - | load=False, save=False |
| Transbordo | `app/transbordo.html` | C | transbordo.html | transbordo.js | transbordo.xml+transbordo.xsl | transbordo | - | - | load=False, save=False |
| Transferencia | `app/transferencia.html` | C | transferencia.html | transferencia.js | transferencia.xml+transferencia.xsl | transferencia | - | - | load=False, save=False |
| Atualizacao | `app/update.php` | C | update.php | - | - | - | - | - | load=False, save=False |
| Espera | `app/upload.html?dir=espera` | R | - | - | - | - | - | - | load=False, save=False |
| Sons | `app/upload.html?dir=sons` | R | - | - | - | - | - | - | load=False, save=False |
| URA | `app/ura.html` | C | ura.html | ura.js | - | - | - | - | load=True, save=True |
| Usuarios | `app/usuarios.html` | C | usuarios.html | usuarios.js | - | - | usuarios | usuarios | load=False, save=False |
| DHCP | `config/dhcpd` | C | - | - | - | - | - | - | load=False, save=False |
| Firewall | `config/firewalld` | C | - | - | - | - | - | - | load=False, save=False |
| VPN | `config/ipsec` | C | - | - | - | - | - | - | load=False, save=False |
| Rede | `config/net` | C | - | - | - | - | - | - | load=False, save=False |
| dash.html | `dash.html` | - | - | - | - | - | - | - | - |
| rfone/Rfone.bin | `rfone/Rfone.bin` | - | - | - | - | - | - | - | - |
| rfone/Rfone_Setup.exe | `rfone/Rfone_Setup.exe` | - | - | - | - | - | - | - | - |

## Detalhamento Funcional (para direcionar a implementacao)

Notas:
- Os links `.html` do menu nem sempre estao presentes no dump, entao parte do detalhamento abaixo e uma **especificacao proposta** (a validar no legado em producao).
- Onde foi possivel, eu usei evidencias do dump de scripts PHP em `remote-dumps/ripabx-web-all-php/html/app/*.php`.

Padrao minimo esperado para telas CRUD/listas (quando aplicavel):
- Listagem com busca, filtros, ordenacao e paginacao.
- Criar/editar/excluir com confirmacao e mensagens de erro claras.
- Validacoes (campo obrigatorio, formato, unicidade) no cliente e no servidor.
- Exportacao (CSV/XLS) quando fizer sentido para operacao.
- Auditoria basica: quem alterou, quando, e o que mudou (ao menos para configuracoes criticas).

Padrao obrigatorio (UI) para novas telas: **DataGrid estilo RIPABX (jqGrid)**:
- A tela e centrada em uma **grade** (lista) com paginação, ordenacao por coluna e busca rapida.
- Acoes primarias ficam sempre visiveis (ex.: `Novo`, `Salvar`, `Excluir`, `Exportar`), sem esconder em menus.
- Edicao deve ser simples para usuario nao tecnico:
  - Preferencia: **painel lateral** (ou modal) com formulario e botao `Salvar`.
  - Selecao de linha na grade preenche o formulario (padrao "clicou, editou").
- Rodape/pager visivel (ex.: "Mostrando X-Y de Z", tamanho de pagina, pagina atual).
- Colunas com valores tecnicos devem ter **label amigavel** e (quando aplicavel) tooltip/ajuda curta.
- Estado de erro nao pode "quebrar" a tela: mostrar banner/callout no contexto e manter o grid usavel.

Padrao obrigatorio (API) para telas DataGrid com muitos registros:
- Backend deve suportar paginação e ordenacao no estilo jqGrid (ou adaptador equivalente):
  - `page` (1-based), `rows` (page size), `sidx` (campo/coluna), `sord` (`asc|desc`)
  - Filtro rapido: `q` (texto livre) ou `search` (a definir por modulo)
- Resposta deve incluir metadados de paginação:
  - `items` (array), `page`, `totalPages`, `totalItems`
- Exportacao deve ser endpoint separado (CSV/XLS) quando o volume for grande (nao exportar do cliente).

### dash.html (Inicio)

Objetivo:
- Tela inicial com resumo do estado do PBX e atalhos para configuracoes e relatorios.

Minimo:
- Cards: chamadas hoje, chamadas em andamento, filas ativas, agentes logados (se Contact Center estiver em uso).
- Saude: status Asterisk (up/down), uso de disco (no legado existe barra de "Espaco Usado" no topo do menu), status das integracoes (MySQL, AMI).
- Atalhos para: Ramais, Operadoras/Rotas, URA, CDR, Gravacoes.

### app/painel.html (Painel)

Objetivo:
- Painel operacional em tempo real (NOC/operacao) com indicadores e lista de eventos.

Minimo:
- Filas: esperando, atendendo, SLA (tempo medio de espera/atendimento), abandonos.
- Agentes: status (logado/pausa/atendendo), tempo no estado, ramal.
- Trunks/Operadoras: registrado, canais em uso, falhas recentes.
- Atualizacao automatica (polling/WebSocket) com degradacao graciosa (se realtime cair, manter polling).

### app/ddr.html (DDR)

Objetivo:
- Gerenciar numeros de entrada (DID/DDI) e seus destinos.

Minimo:
- Campos: numero DDR, descricao, destino (ramal/fila/URA/grupo/sala), horario (opcional), ativo.
- Regras: numero unico, apenas digitos, tamanho minimo/maximo.
- Aceite: chamada para o numero DDR toca no destino configurado.

### app/grupo.html (Grupos)

Objetivo:
- Grupos de toque (ring groups) e/ou agrupadores logicos de ramais.

Minimo:
- Campos: nome, ramais membros, estrategia (simultaneo/sequencial), timeout, fallback (URA/fila/ramal), ativo.
- Aceite: ao discar o numero do grupo, aplica estrategia e fallback.

### app/ramais.html (Ramais)

Objetivo:
- Cadastro de ramais (extensoes) e credenciais SIP.

Minimo:
- Campos: numero do ramal, nome, senha/secret, contexto/perfil, callerid, voicemail (se existir), limites (max chamadas), permissoes de discagem (classes/categorias).
- Acoes: resetar senha, bloquear/desbloquear, exportar lista.
- Aceite: ramal registra e faz/recebe chamadas conforme politicas.

### app/desvio.html (Desvio)

Objetivo:
- Regras de desvio (call forwarding).

Minimo:
- Tipos: sempre, ocupado, nao atende (timeout), fora do horario.
- Campos: origem (ramal/grupo/fila), destino (numero/ramal/fila/URA), condicao, ativo.
- Aceite: chamadas seguem a condicao configurada.

### app/transbordo.html (Transbordo)

Objetivo:
- Transbordo/overflow (ex.: fila transborda para outra fila/ramal/URA).

Minimo:
- Condicoes: tempo em fila, quantidade de chamadas esperando, horario, indisponibilidade de agentes.
- Campos: origem, condicao, destino, ativo.
- Aceite: quando condicao e atingida, roteia conforme regra.

### app/bloqueio.html (Bloqueio)

Objetivo:
- Bloqueio de chamadas (lista negra / bloqueio por categoria / bloqueio de DDD/DDI).

Minimo:
- Tipos: blacklist por numero, bloqueio por prefixo, bloqueio por horario.
- Campos: numero/prefixo, motivo, ativo, expiracao (opcional).
- Aceite: chamadas bloqueadas caem em tratamento definido (ocupado/mensagem/URA).

### app/retorno.html (Retorno)

Objetivo:
- Politicas de retorno/callback (a validar: pode ser callback de fila, retorno de chamada perdida, ou regra de rediscagem).

Minimo:
- Definir o que e "retorno" no legado (fonte de eventos) e como dispara acao.
- Se for callback: fila/campanha, janela de tempo, tentativas, intervalo, identificacao do cliente.

### app/recusa.html (Recusa)

Objetivo:
- Regras de recusa (a validar: DND, recusa de chamadas anonimas, recusa por lista).

Minimo:
- Configurar recusas por ramal e por numeros.
- Aceite: chamadas recusadas recebem tratamento consistente (ex.: busy/403, mensagem, etc).

### app/feriado.html (Feriado)

Objetivo:
- Cadastro de feriados e horarios especiais para roteamento.

Minimo:
- Campos: data, descricao, escopo (global/por DDR/fila), acao (destino em feriado).
- Aceite: em feriados, aplica destino alternativo (ex.: URA de plantao).

### app/transferencia.html (Transferencia)

Objetivo:
- Politicas e configuracoes de transferencia (a validar: transferencia assistida/cega, lista de codigos, destino permitido).

Minimo:
- Codigos/feature codes (se aplicavel), permissao por categoria, regras de gravacao em transferencias.

### app/upload.html?dir=espera (Audios: Espera)

Objetivo:
- Upload e gestao de audios de espera (musica/avisos).

Evidencia no dump:
- `remote-dumps/ripabx-web-all-php/html/app/upload.php` escolhe pasta por `dir`:
  - `dir=espera` -> `/opt/results/telefonia/ripabx/html/espera/`
  - `dir=sons` -> `/opt/results/telefonia/ripabx/html/sons/`

Minimo:
- Listar arquivos existentes, tocar preview, upload, renomear, remover.
- Validar formato e (re)codificar automaticamente para padrao telefonia.

Padrao recomendado de audio:
- WAV 8kHz, mono, PCM signed (no legado existe conversao com `sox` em `remote-dumps/ripabx-web-all-php/html/app/converter_audio.php`).

### app/upload.html?dir=sons (Audios: Sons)

Objetivo:
- Upload e gestao de "sons" (prompts/locucoes usadas em URA, mensagens, etc).

Minimo:
- Mesmas capacidades de "Espera".
- Referencias: facilitar copiar o nome do arquivo para usar na URA/regras.

### app/cdr.html (Relatorios: Ligacoes)

Objetivo:
- Consultar CDR (Call Detail Records) e exportar.

Evidencia no dump:
- Listagem paginada/ordenada por jqGrid em `remote-dumps/ripabx-web-all-php/html/app/cdr_rel_dados.php`.
- Exportacao XLS em `remote-dumps/ripabx-web-all-php/html/app/cdr_excel.php`.

Minimo:
- Filtros: periodo (data inicio/fim), origem (src), destino (dst).
- Campos: data/hora, origem, destino, duracao, billsec, status (ANSWERED/NO ANSWER/BUSY/FAILED), uniqueid, accountcode, userfield, valor.
- Exportar XLS/CSV preservando filtros.

### app/fax_rel.html (Relatorios: Fax)

Objetivo:
- Relatorio de faxes enviados/recebidos (a validar fonte de dados).

Minimo:
- Filtros por periodo e status.
- Itens: numero destino, arquivo enviado, data/hora, status, erro (se houver).

### app/sac.html (Relatorios: Gravacoes)

Objetivo:
- Listar chamadas com gravacao e permitir download/playback.

Evidencia no dump:
- `remote-dumps/ripabx-web-all-php/html/app/sac_rel_dados.php` filtra CDR com `audio is not null` e retorna campo `audio`.

Minimo:
- Mesmos filtros do CDR (periodo/origem/destino) + apenas gravadas.
- Acao: tocar audio no browser e/ou baixar.

### app/resumo.html (Relatorios: Resumo)

Objetivo:
- Relatorio consolidado (a validar: por dia/ramal/operadora/fila).

Minimo:
- Metricas: total, atendidas, nao atendidas, duracao total, custo (se `valor` existir), top origens/destinos.
- Exportacao.

### app/hora.html (Relatorios: Hora)

Objetivo:
- Distribuicao por hora (heatmap/serie temporal).

Minimo:
- Chamadas por hora, duracao media, atendidas vs nao atendidas.

### app/origem.html (Relatorios: Origem)

Objetivo:
- Relatorio agrupado por origem (src).

Minimo:
- Ranking de origens, volume, duracao, taxa de atendimento, custo (se houver).

### app/destino.html (Relatorios: Destino)

Objetivo:
- Relatorio agrupado por destino (dst).

Minimo:
- Ranking de destinos, volume, duracao, custo (se houver).

### app/configuracoes.html (Configuracoes)

Objetivo:
- Configurar parametros centrais e gerar arquivos de configuracao do sistema.

Evidencia no dump (gera arquivos e recarrega):
- `remote-dumps/ripabx-web-all-php/html/app/configuracoes.php` escreve:
  - DB: `/opt/results/telefonia/ripabx/conf/config_db.php`, `/opt/results/telefonia/ripabx/conf/open_db.php`, `/opt/results/telefonia/ripabx/conf/cdr_mysql.conf`, `/opt/results/telefonia/ripabx/conf/res_config_mysql.conf`
  - Asterisk: `/opt/results/telefonia/ripabx/conf/ip_externo.conf`, `/opt/results/telefonia/ripabx/conf/localnet.conf`, `/opt/results/telefonia/ripabx/conf/manager.conf`
  - Discador/integracoes: `/opt/results/telefonia/ripabx/conf/discador.conf`
  - Monitoramento: `/opt/results/telefonia/ripabx/conf/api-users.conf`
  - Persistencia de UI: `/opt/results/telefonia/ripabx/dados/xml/configuracoes.xml`
  - E executa: `/opt/results/telefonia/ripabx/bin/recarrega.sh`

Minimo:
- Campos: externip, localnet, MySQL host/user/pass, AMI user/secret, parametros do discador (int_rediscagem, ponderacao), integracoes Avaya/Twilio (conforme `discador.conf`), usuario/senha da API de monitoramento.
- Validar conectividade (test connection) antes de gravar.
- Aplicar configuracao de forma atomica (ou grava tudo ou nada) e com rollback simples.

### app/operadoras.html (Operadoras)

Objetivo:
- Cadastro de operadoras/troncos (SIP/PJSIP/analogico via gateway).

Minimo:
- Campos: nome, tecnologia, host, usuario, senha, registro, codecs, rotas associadas, limites.
- Aceite: tronco registra e efetua chamadas de saida.

### app/rotas.html (Rotas)

Objetivo:
- Rotas de saida (outbound routing).

Minimo:
- Regras: prefixos/padroes (ex.: 0Z., 00., etc), prioridade, operadora/tronco, categoria.
- Simulador: dado um numero, qual rota seria aplicada.

### app/categoria.html (Categoria)

Objetivo:
- Categorias de discagem (classes de servico) e politicas de bloqueio/custo.

Minimo:
- Regras por categoria: permitir/bloquear prefixos, limites, horarios.
- Vinculo: ramal -> categoria.

### app/fax.html (Fax)

Objetivo:
- Envio e configuracao de fax.

Evidencia no dump (envio):
- `remote-dumps/ripabx-web-all-php/html/app/fax.php`:
  - Recebe `fax`, `email` e arquivo (upload).
  - Converte para TIFF fax (ImageMagick `convert`) e cria `.call` em `/var/spool/asterisk/outgoing/`.
  - Usa `Channel: khomp/Gfax/<fax>` e `Context: enviarfax`.

Minimo:
- Tela de envio: numero fax, email para confirmacao, upload arquivo, validar obrigatorios.
- Mostrar status do envio (a validar: leitura de spool/log).

### app/facilidades.html (Facilidades)

Objetivo:
- Feature codes e facilidades de telefonia (a validar: captura, pickup, transferencia, consulta, etc).

Minimo:
- Listar codigos e permitir alterar (com validacao) e documentar efeito.

### app/ura.html (URA)

Objetivo:
- Editor de URA (fluxo) e geracao de dialplan.

Evidencia no dump:
- `remote-dumps/ripabx-web-all-php/html/app/ura_save.php` grava:
  - diagrama JSON em `/opt/results/telefonia/ripabx/dados/json/ura.json`
  - dialplan em `/opt/results/telefonia/ripabx/conf/ura.conf`

Minimo:
- Editor visual (nodes/edges), validacao de fluxo, preview do dialplan gerado.
- Publicar (salvar) com feedback de sucesso/erro.
- Versionamento simples: historico de alteracoes e botao de rollback para versao anterior.

### app/sala.html (Sala)

Objetivo:
- Salas de conferencia (bridge).

Minimo:
- Campos: numero sala, PIN (opcional), gravar (sim/nao), limite participantes.
- Aceite: discagem para a sala conecta participantes.

### app/interconexao.html (Interconexao)

Objetivo:
- Interconexao com outras centrais/filiais (a validar: IAX/SIP trunk interno, rotas internas).

Minimo:
- Configurar peers/rotas internas e regras de discagem entre unidades.

### app/usuarios.html (Usuarios)

Objetivo:
- Usuarios do sistema (login no painel) e controle de acesso (a validar regras).

Minimo:
- CRUD de usuarios: login, nome, senha, status (ativo/inativo).
- Perfis basicos: leitura vs configuracao (se for aplicavel no novo sistema).

### config/net (Rede)

Objetivo:
- Configurar rede do appliance/servidor.

Minimo:
- Campos: IP, mascara, gateway, DNS, hostname, modo DHCP vs estatico.
- Aplicar com seguranca: validar IP/mask, confirmar antes, janela de rollback (ex.: reverter em 60s se nao confirmar).

### config/dhcpd (DHCP)

Objetivo:
- Configurar servidor DHCP (faixa, reservas).

Minimo:
- Faixa IP, lease time, gateway/DNS, reservas por MAC, opcoes para telefones IP.

### config/firewalld (Firewall)

Objetivo:
- Regras de firewall.

Minimo:
- Abrir/fechar portas (SIP/RTP/AMI/HTTP/HTTPS), listas permitidas por IP.
- Validacao para nao bloquear acesso atual do admin.

### config/ipsec (VPN)

Objetivo:
- VPN IPsec (site-to-site) para integrar filiais/provedores.

Minimo:
- Parametros de tunel: peer, PSK/cert, subnets locais/remotas, fase1/fase2, DPD.
- Teste de conectividade e status.

### app/licenca.php (Licenca)

Objetivo:
- Gerenciar chaves/licencas do produto.

Evidencia no dump:
- `remote-dumps/ripabx-web-all-php/html/app/licenca.php` le:
  - `/opt/results/licenca/ripabx.txt`
  - `/opt/results/licenca/icinga.txt`

Minimo:
- Exibir chave atual, permitir atualizar, mostrar status (valida/expirada) e capacidade liberada.

### app/update.php (Atualizacao)

Objetivo:
- Atualizacao do sistema com verificador de versao e progresso.

Evidencia no dump:
- `remote-dumps/ripabx-web-all-php/html/app/update.php` compara versao atual vs disponivel (URL repo) e dispara download + unzip via CGI.
- `remote-dumps/ripabx-web-all-php/html/app/update_download.php` faz download com progresso (SSE) via curl.

Minimo:
- Mostrar versao atual, versao disponivel, changelog (se existir).
- Processo com logs e rollback (ou ao menos backup antes de aplicar).

### /cgi/ripabx/assistencia.cgi (Assistencia)

Objetivo:
- Canal de suporte/assistencia (a validar comportamento).

Minimo:
- Capturar diagnosticos, gerar pacote de logs, abrir solicitacao (manual).

### Mapeamento CGI/JSS (backend legado)

Objetivo:
- Consolidar os endpoints `.cgi`/`.jss` usados pelo frontend/PHP legado e o fluxo de chamada.

Importante:
- No dump analisado, nao existem arquivos binarios `.cgi`/`.jss` implementados.
- O que existe no repositorio sao os chamadores (HTML/JS/PHP) que apontam para `/cgi/...`.

#### Gateways principais

1. `app/server.php` (bridge de CRUD para PBX XML)
- Evidencia: `remote-dumps2/extracted/ripabx-web-html-app/app/server.php`.
- Recebe `oper` (`add|edit|del`) + `prog` + campos do form/jqGrid.
- Traduz para `opcao=1|2|3` e encaminha para `/cgi/ripabx/*_xml.cgi`.
- Mapeamento de `prog`:
  - `ramal -> /cgi/ripabx/ramal_xml.cgi`
  - `fax -> /cgi/ripabx/fax_xml.cgi`
  - `desvio -> /cgi/ripabx/desvio_xml.cgi`
  - `grupo -> /cgi/ripabx/grupo_xml.cgi`
  - `fila -> /cgi/ripabx/fila_xml.cgi`
  - `ddr -> /cgi/ripabx/ddr_xml.cgi`
  - `transbordo -> /cgi/ripabx/transbordo_xml.cgi`
  - `bloqueio -> /cgi/ripabx/bloqueio_xml.cgi`
  - `interconexao -> /cgi/ripabx/interconexao_xml.cgi`
  - `recusa -> /cgi/ripabx/recusa_xml.cgi`
  - `retorno -> /cgi/ripabx/retorno_xml.cgi`
  - `transferencia -> /cgi/ripabx/transferencia_xml.cgi`
  - `feriado -> /cgi/ripabx/feriado_xml.cgi`
  - `operadora -> /cgi/ripabx/operadora_xml.cgi`
  - `rota_base -> /cgi/ripabx/rota_base_xml.cgi`
  - `rota -> /cgi/ripabx/rota_xml.cgi`
  - `tipo -> /cgi/ripabx/tipo_xml.cgi`
  - `categoria -> /cgi/ripabx/categoria_xml.cgi`
  - `sala -> /cgi/ripabx/sala_xml.cgi`
  - `motivo -> /cgi/ripabx/motivo_xml.cgi`
  - `motivo1 -> /cgi/ripabx/motivo1_xml.cgi`

2. `app/sip_config.php` (teste SIP)
- Evidencia: `remote-dumps2/extracted/ripabx-web-html-app/app/sip_config.php`.
- Persiste request em `/opt/results/ria/sip.json`.
- Prepara chamada para `/cgi/ripabx/sip_teste.cgi`.

#### Endpoints CGI/JSS encontrados

| Endpoint | Origem no codigo | Finalidade inferida |
|---|---|---|
| `/cgi/ripabx/assistencia.cgi` | `app/js/assistencia.js`, `menu.php`, `menu2.php` | Iniciar/finalizar sessao de assistencia remota |
| `/cgi/ripabx/update.cgi` | `app/update.php` | Etapa de descompactacao/aplicacao de update |
| `/cgi/ripabx/sip_teste.cgi` | `app/sip_config.php` | Teste de conectividade/config SIP |
| `/cgi/ripabx/mensagens.cgi` | `app/js/ripabx.js` | Mensagens/notificacoes do topo da UI |
| `/cgi/ripabx/licenca.cgi` | `app/licenca.js` | Recuperar chave/licenca |
| `/cgi/ripabx/checa_licenca.cgi` | `app/licenca.js` | Validar status da licenca (`ripabx`, `icinga`) |
| `/cgi/ripabx/listalinks.cgi` | `app/operadoras.js` | Lista de links E1 para operadoras |
| `/cgi/ripabx/listacanais.cgi` | `app/operadoras.js` | Lista de canais E1 para operadoras |
| `/cgi/ripabx/ripabx_xml.cgi` | `app/server.js` | Gravacao direta de dados de ramal (form simples) |
| `/cgi/ripabx/contexto.cgi` | `app/rotas.js` | Visualizacao de contexto da rota selecionada |
| `/cgi/ripabx/360dialog_get_webhook.jss` | `app/configuracoes.js` | Consulta webhook do broker 360dialog |
| `/cgi/ripabx/360dialog_set_webhook.jss` | `app/configuracoes.js` (comentado) | Atualizacao de webhook 360dialog |
| `/cgi/cdr.cgi` | `app/lista.js` | Consulta de CDR para relatorio com XSL |

#### Familia `*_xml.cgi` (CRUD PBX legado)

- Todos usados via `app/server.php`, acionados por telas jqGrid/XML:
  - `/cgi/ripabx/ramal_xml.cgi`
  - `/cgi/ripabx/fax_xml.cgi`
  - `/cgi/ripabx/desvio_xml.cgi`
  - `/cgi/ripabx/grupo_xml.cgi`
  - `/cgi/ripabx/fila_xml.cgi`
  - `/cgi/ripabx/ddr_xml.cgi`
  - `/cgi/ripabx/transbordo_xml.cgi`
  - `/cgi/ripabx/bloqueio_xml.cgi`
  - `/cgi/ripabx/interconexao_xml.cgi`
  - `/cgi/ripabx/recusa_xml.cgi`
  - `/cgi/ripabx/retorno_xml.cgi`
  - `/cgi/ripabx/transferencia_xml.cgi`
  - `/cgi/ripabx/feriado_xml.cgi`
  - `/cgi/ripabx/operadora_xml.cgi`
  - `/cgi/ripabx/rota_base_xml.cgi`
  - `/cgi/ripabx/rota_xml.cgi`
  - `/cgi/ripabx/tipo_xml.cgi`
  - `/cgi/ripabx/categoria_xml.cgi`
  - `/cgi/ripabx/sala_xml.cgi`
  - `/cgi/ripabx/motivo_xml.cgi`
  - `/cgi/ripabx/motivo1_xml.cgi`

Leitura funcional:
- `app/xml.php`/`app/xml2.php` leem XML para montar telas.
- `app/server.php` grava/edita/exclui via CGI.
- O backend real da regra de negocio esta nos CGIs fora do dump.

### Conjunto .html + .js + .xml + .php + .cgi que define o comportamento

Regra pratica:
1. `.html` define a tela (containers, formulario, grid, botoes).
2. `.js` define eventos, validacoes, carga de dados e chamadas de persistencia.
3. `.xml` + `.xsl` definem o modelo legado de dados exibidos em grid/form.
4. `.php` funciona como adaptador (le XML, grava, integra com DB/API/sistema).
5. `.cgi/.jss` executa a regra de negocio final no backend legado (fora do dump).

Fluxo tipico (CRUD PBX legado):
- `app/<modulo>.html` -> carrega `app/<modulo>.js`
- `app/<modulo>.js` -> leitura por `app/xml.php?xml=<arquivo>.xml&xsl=<arquivo>.xsl`
- `app/<modulo>.js` -> gravacao por `app/server.php?prog=<modulo>`
- `app/server.php` -> encaminha para `/cgi/ripabx/<modulo>_xml.cgi`

#### Exemplos fechados (fim a fim)

1. Ramais
- HTML: `app/ramais.html`
- JS: `app/ramais.js`
- XML/XSL (read): `grupo.xml+grupo2.xsl`, `categoria.xml+categoria2.xsl`, `ramal.xml+ramal.xsl`
- PHP (write): `app/server.php?prog=ramal`
- CGI final: `/cgi/ripabx/ramal_xml.cgi`

2. Operadoras
- HTML: `app/operadoras.html`
- JS: `app/operadoras.js`
- XML/XSL (read): `operadora.xml+operadora.xsl`
- PHP (write): `app/server.php?prog=operadora`
- CGI final: `/cgi/ripabx/operadora_xml.cgi`

3. Rotas
- HTML: `app/rotas.html`
- JS: `app/rotas.js`
- XML/XSL (read): `operadora.xml+operadora2.xsl`, `rota_base.xml+rota_base.xsl`, `rota.xml+rota.xsl`
- PHP (write): `app/server.php?prog=rota_base` e `app/server.php?prog=rota`
- CGI final: `/cgi/ripabx/rota_base_xml.cgi` e `/cgi/ripabx/rota_xml.cgi`
- CGI auxiliar: `cgi/ripabx/contexto.cgi?rota=<id>`

4. Fila (Contact Center)
- HTML: `app/fila.html`
- JS: `app/fila.js`
- XML/XSL (read): `fila.xml+fila.xsl`
- PHP (write): `app/server.php?prog=fila`
- CGI final: `/cgi/ripabx/fila_xml.cgi`

5. Categoria
- HTML: `app/categoria.html`
- JS: `app/categoria.js`
- XML/XSL (read): `tipo.xml+tipo2.xsl`, `rota_base.xml+rota2.xsl`, `categoria.xml+categoria.xsl`
- PHP (write): `app/server.php?prog=categoria`
- CGI final: `/cgi/ripabx/categoria_xml.cgi`

6. Configuracoes gerais
- HTML: `app/configuracoes.html`
- JS: `app/configuracoes.js`
- PHP: `app/configuracoes.php`, `app/xml2.php?xml=configuracoes.xml`, `app/ext_ip.php`, `app/localnet.php`, `app/teste_mysql.php`
- JSS/CGI: `/cgi/ripabx/360dialog_get_webhook.jss` (e `...set_webhook.jss` comentado)

7. Licenca
- HTML: `app/licenca.php`
- JS: `app/licenca.js`
- PHP: `app/licenca2.php`
- CGI: `/cgi/ripabx/licenca.cgi`, `/cgi/ripabx/checa_licenca.cgi`

8. Atualizacao
- HTML/PHP: `app/update.php`
- JS de progresso: `app/js/progress.js`
- PHP download: `app/update_download.php`
- CGI aplicacao: `/cgi/ripabx/update.cgi`

Conclusao operacional:
- O comportamento real da plataforma e definido pelo conjunto completo dessas 5 camadas.
- Sem qualquer uma delas (ex.: XML/XSL ausente, `server.php` ausente, CGI indisponivel), a funcionalidade fica parcial ou quebrada.

### app/recarga.php (Recarga)

Objetivo:
- Recarregar servicos/configuracoes sem reinicio completo.

Evidencia no dump:
- `remote-dumps/ripabx-web-all-php/html/app/recarga.php` executa `/opt/results/telefonia/ripabx/bin/recarrega.sh servicos`.

Minimo:
- Botao "recarregar" com resultado (ok/erro), tempo e logs basicos.

### app/fila.html (Contact Center: Fila)

Objetivo:
- Cadastro/configuracao de filas do contact center.

Minimo:
- Campos: numero/nome fila, estrategia, musica de espera, timeout, max wait, anuncio, gravacao, destino quando fechado.
- Membros: agentes (ramais), penalidade/prioridade, pausas.
- Aceite: fila recebe chamadas e distribui para agentes.

### app/motivo.html (Motivo Pausa)

Objetivo:
- Motivos de pausa (wrap-up) para agentes.

Minimo:
- CRUD de motivos: codigo, descricao, obrigatorio (sim/nao), limite de tempo (opcional).

### app/motivo1.html (Motivo Contato)

Objetivo:
- Motivos de contato (disposicao) para classificar atendimentos.

Minimo:
- CRUD de motivos: codigo, descricao, grupo, obrigatorio, ativo.

### app/campanha.html (Campanhas)

Objetivo:
- Campanhas (discador/click2call/relatorios).

Minimo:
- Campos: id/descricao, click2call on/off, filas/rotas associadas, horario, lista de contatos (se existir).

### app/agendado.html (CallBack Agendado)

Objetivo:
- Agendar callback para clientes.

Minimo:
- Campos: cliente (DDD+telefone), campanha/fila, data/hora, agente (opcional), status, tentativas.
- Acoes: reagendar, cancelar, marcar como concluido.

### app/fila_atendidas.html (Relatorio: atendidas)

Objetivo:
- Relatorio de atendimentos por fila.

Minimo:
- Filtros: periodo, fila, agente.
- Metricas: tempo de espera, tempo de atendimento, SLA.

### app/fila_abandonadas.html (Relatorio: abandonadas)

Objetivo:
- Abandonos por fila e horario.

Minimo:
- Filtros: periodo, fila.
- Metricas: abandonos, tempo medio ate abandono.

### app/fila_agentes.html (Relatorio: agentes)

Objetivo:
- Performance por agente.

Minimo:
- Metricas: atendidas, tempo logado, tempo em pausa, TMA, pausas por motivo.

### app/fila_hora.html (Relatorio: por hora)

Objetivo:
- Distribuicao por hora (demanda) das filas.

Minimo:
- Metricas por hora: recebidas, atendidas, abandonadas, SLA.

### app/filas_resumo.html (Relatorio: Resumo por campanha)

Objetivo:
- Resumo consolidado por campanha/fila.

Minimo:
- Metricas: volume, atendidas, abandonos, conversao (se houver), custo.

### app/pesquisa.html (Relatorio: Pesquisa)

Objetivo:
- Relatorio de pesquisas/satisfacao (a validar fonte e modelo).

Minimo:
- Exibir resultados por periodo/campanha, notas, distribuicao e comentarios (se existir).

### app/click2call.php (Extras: Click2Call)

Objetivo:
- Disparar uma chamada de saida a partir do sistema, conectando cliente a um "departamento" (fila/ramal).

Evidencia no dump:
- `remote-dumps/ripabx-web-all-php/html/app/click2call.php`:
  - "Via campanha": carrega `idcampanha, descricao` da tabela `campanha` onde `click2call='on'`.
  - Recebe `DDD` e `numeroTelefone`.
  - "Direto": lista destinos fixos (ex.: 9995 Atendimento, 5002 Jefferson, 5003 PW).

Minimo:
- Entrada: DDD + telefone, e destino (por campanha ou direto).
- Validar numero (DDD 2 digitos, telefone 8-9 digitos) e normalizar.
- Retornar status do pedido (enfileirado, falhou, motivo).

### rfone/Rfone_Setup.exe e rfone/Rfone.bin (Downloads)

Objetivo:
- Disponibilizar clientes Rfone.

Minimo:
- Pagina simples com versao, checksum, data da build, notas de instalacao.

## Itens Desconsiderados (fora do escopo)

Os itens abaixo aparecem em menus/legados, mas **devem ser desconsiderados** para o checklist de paridade desta versao:

- Contact Center > Extras: `Chats` (`app/chat.html`)
- Secao `Bots` (todas as telas/links): `app/rchatbot_man.html`, `app/rchatbot_chats.html`, `app/voicebot.php`
- Secao `Monitoramento` (todas as telas/links): `app/mon_*`
- Secao `R-BI` (Pentaho embed): `/pentaho/embed-login?...`
- Itens extras do `menu.php` (legado), incluindo:
  - Dashboards comentados (`/dash/app/index.html`, `app/cockpit.html`, `app/dashboard.html`, `app/dash_filas.html`, `app/dash_agentes.html`)
  - Configuracoes: `app/servicos.html` e `/pm2`
  - Bots > Relatorios: `whatsapp/status` (R-WA Avaya)
  - Inteligencia Artificial: `app/tron_*`, `app/objetivos.html`, `app/regras.html`, `app/memorias.html`, `app/sip_config.html`

## Mapeamento Sugerido (legado -> novo r-agent2)

Tabela para acelerar a implementacao no novo frontend (nomes sugeridos, ajustar conforme o produto):

| Legado (RIPABX) | Novo (r-agent2) | Observacao |
| --- | --- | --- |
| `dash.html` | `PBX > Visao geral` | cards e saude do stack |
| `app/painel.html` | `PBX > Monitor tempo real` | filas/agentes/trunks (se aplicavel) |
| `app/ddr.html` | `PBX > DIDs (numeros de entrada)` | roteamento inbound |
| `app/grupo.html` | `PBX > Grupos/Ring groups` | estrategia de toque + fallback |
| `app/ramais.html` | `PBX > Ramais/Extensoes` | credenciais SIP + politicas |
| `app/desvio.html` | `PBX > Regras de desvio` | sempre/ocupado/nao atende |
| `app/transbordo.html` | `PBX > Overflow/Transbordo` | regras por tempo/volume |
| `app/bloqueio.html` | `PBX > Bloqueios` | blacklist/prefixos |
| `app/feriado.html` | `PBX > Calendario/Feriados` | roteamento por data |
| `app/upload.html?dir=espera` | `PBX > Audios (Espera)` | assets + conversao |
| `app/upload.html?dir=sons` | `PBX > Audios (Sons)` | prompts URA |
| `app/cdr.html` | `PBX > CDR` | filtros + exportacao |
| `app/sac.html` | `PBX > Gravacoes` | playback/download |
| `app/ura.html` | `Fluxos > Editor (voz/URA)` | nodes de voz + publicar dialplan |
| `app/operadoras.html` | `PBX > Trunks/Operadoras` | SIP/PJSIP + status |
| `app/rotas.html` | `PBX > Rotas de saida` | dialplan outbound |
| `app/categoria.html` | `PBX > Categorias/Classes` | permissoes de discagem |
| `app/fax.html` | `PBX > Fax` | envio + status |
| `app/sala.html` | `PBX > Salas` | conferencia |
| `app/usuarios.html` | `Admin > Usuarios` | RBAC simplificado |
| `config/net` | `Admin > Rede` | aplicar com rollback |
| `config/dhcpd` | `Admin > DHCP` | opcional |
| `config/firewalld` | `Admin > Firewall` | opcional |
| `config/ipsec` | `Admin > VPN` | opcional |
| `app/configuracoes.html` | `Admin > Configuracoes PBX` | AMI/MySQL/externip/localnet |
| `app/licenca.php` | `Admin > Licencas` | chaves + status |
| `app/update.php` | `Admin > Atualizacao` | fluxo com logs/rollback |
| `app/recarga.php` | `Admin > Recarregar servicos` | botao seguro |
| `app/fila.html` | `Contact Center > Filas` | se CC estiver no escopo |
| `app/motivo.html` | `Contact Center > Motivos de pausa` | se CC estiver no escopo |
| `app/motivo1.html` | `Contact Center > Motivos de contato` | se CC estiver no escopo |
| `app/campanha.html` | `Contact Center > Campanhas` | se CC estiver no escopo |
| `app/agendado.html` | `Contact Center > Callbacks` | se CC estiver no escopo |
| `app/click2call.php` | `Contact Center > Click2Call` | endpoint de originate/queue |

## Checklist Para Modernizacao

Quando for reescrever a interface do PBX/RIPABX:
- Manter **todos** os itens do baseline (`menu2.php`) disponiveis (mesma capacidade funcional), exceto os listados em **Itens Desconsiderados (fora do escopo)**.
- Se algum item for descontinuado, documentar substituicao (ex.: "ura.html" -> "novo editor URA/voz").


<!-- AUTO:REF_HTML_FIELDS:START -->
## Mapeamento De Campos Dos HTML De Referencia

Fonte utilizada: `remote-dumps2/extracted/ripabx-web-html-app/app/*.html`

Arquivos HTML analisados: **108**
Campos encontrados (input/select/textarea): **190**

### Resumo Por Arquivo

| Arquivo | Campos |
| --- | ---: |
| `app/agendado.html` | 1 |
| `app/agentes.html` | 0 |
| `app/asr.html` | 1 |
| `app/audio.html` | 1 |
| `app/bloqueio.html` | 0 |
| `app/campanha.html` | 3 |
| `app/categoria.html` | 0 |
| `app/cdr.html` | 6 |
| `app/chat.html` | 3 |
| `app/cockpit.html` | 0 |
| `app/configuracoes.html` | 26 |
| `app/dashboard.html` | 9 |
| `app/ddr.html` | 0 |
| `app/destino.html` | 3 |
| `app/desvio.html` | 0 |
| `app/download.html` | 0 |
| `app/espera.html` | 1 |
| `app/facilidades.html` | 14 |
| `app/fax.html` | 0 |
| `app/fax_envio.html` | 4 |
| `app/fax_rel.html` | 6 |
| `app/faxweb.html` | 0 |
| `app/feriado.html` | 0 |
| `app/fila.html` | 0 |
| `app/fila_abandonadas.html` | 5 |
| `app/fila_agentes.html` | 5 |
| `app/fila_atendidas.html` | 5 |
| `app/fila_hora.html` | 4 |
| `app/filas_resumo.html` | 5 |
| `app/form.html` | 4 |
| `app/grupo.html` | 0 |
| `app/hora.html` | 3 |
| `app/index.html` | 1 |
| `app/index2.html` | 0 |
| `app/index3.html` | 0 |
| `app/index_cc.html` | 0 |
| `app/indexteste.html` | 0 |
| `app/interconexao.html` | 0 |
| `app/memorias.html` | 0 |
| `app/menu.html` | 0 |
| `app/mon_app.html` | 0 |
| `app/mon_dependencies.html` | 0 |
| `app/mon_hostgroups.html` | 0 |
| `app/mon_hosts.html` | 0 |
| `app/mon_notifications.html` | 0 |
| `app/mon_os.html` | 0 |
| `app/mon_servicegroups.html` | 0 |
| `app/mon_services.html` | 0 |
| `app/mon_timeperiods.html` | 0 |
| `app/mon_usergroups.html` | 0 |
| `app/mon_users.html` | 0 |
| `app/mon_zones.html` | 0 |
| `app/motivo.html` | 0 |
| `app/motivo1.html` | 0 |
| `app/objetivos.html` | 0 |
| `app/operadoras.html` | 0 |
| `app/origem.html` | 3 |
| `app/painel.html` | 1 |
| `app/painel2.html` | 0 |
| `app/palavras.html` | 0 |
| `app/permissao.html` | 0 |
| `app/pesquisa.html` | 4 |
| `app/ramais.html` | 0 |
| `app/rchatbot.html` | 1 |
| `app/rchatbot_chats.html` | 0 |
| `app/rchatbot_man.html` | 7 |
| `app/recusa.html` | 0 |
| `app/regras.html` | 0 |
| `app/resumo.html` | 6 |
| `app/retorno.html` | 0 |
| `app/rfone.html` | 12 |
| `app/rfone2.html` | 12 |
| `app/ring.html` | 0 |
| `app/rotas.html` | 0 |
| `app/sac.html` | 6 |
| `app/sac_rel.html` | 0 |
| `app/sala.html` | 0 |
| `app/server.html` | 0 |
| `app/servicos.html` | 0 |
| `app/sip_config.html` | 6 |
| `app/sons.html` | 1 |
| `app/substitutos.html` | 0 |
| `app/tab.html` | 0 |
| `app/temp/index.html` | 0 |
| `app/term.html` | 0 |
| `app/teste.html` | 1 |
| `app/teste2.html` | 0 |
| `app/teste3.html` | 0 |
| `app/teste_painel.html` | 2 |
| `app/teste_tree.html` | 0 |
| `app/teste_ura.html` | 0 |
| `app/tipo.html` | 0 |
| `app/transbordo.html` | 0 |
| `app/transferencia.html` | 0 |
| `app/tron_clientes.html` | 0 |
| `app/tron_config.html` | 9 |
| `app/tron_dicionario.html` | 0 |
| `app/tron_palavras_base.html` | 0 |
| `app/tron_palavras_sinonimos.html` | 0 |
| `app/tron_substituidos.html` | 0 |
| `app/tron_substitutos.html` | 0 |
| `app/tts.html` | 2 |
| `app/upload.html` | 3 |
| `app/upload2.html` | 4 |
| `app/ura.html` | 0 |
| `app/ura1.html` | 0 |
| `app/usuarios.html` | 0 |
| `app/xml.html` | 0 |

### Detalhamento De Campos

#### `app/agendado.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 17 | input | file | files[] | arquivo |  |  |

#### `app/agentes.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de listagem/tabela sem formulário estático; entradas são tratadas por script. Scripts principais: `app/agentes.js`.

#### `app/asr.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 24 | input | file |  | audio-file |  |  |

#### `app/audio.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 2 | input | Arquivo | file_upload | file_upload |  |  |

#### `app/bloqueio.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `bloqueio`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/bloqueio.js`.

#### `app/campanha.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 27 | input | file | files[] | arquivo |  |  |
| 57 | input | hidden | redirect |  |  | https://blueimp.github.io/jQuery-File-Upload/ |
| 65 | input | file | files[] |  |  |  |

#### `app/categoria.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `categoria`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/categoria.js`.

#### `app/cdr.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | cdr |
| 4 | input | text | dataini | cdrdataini |  |  |
| 5 | input | text | datafim | cdrdatafim |  |  |
| 7 | input | text | origem | cdrorigem |  |  |
| 9 | input | text | destino | cdrdestino |  |  |
| 10 | input | submit |  |  |  | Listar |

#### `app/chat.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 18 | input | text |  |  | Pesquisa |  |
| 435 | input | file |  |  |  |  |
| 438 | input | text |  |  | Digite |  |

#### `app/cockpit.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela contêiner com `iframe`; os campos ficam na página carregada dentro do frame. Título: `Embedded Cockpit`.

#### `app/configuracoes.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 10 | input | textbox | externip | externip |  |  |
| 11 | input | button |  | descobrir_ip |  | Descobrir IP |
| 15 | input | textbox | servidor_mysql | servidor_mysql |  |  |
| 19 | input | textbox | usuario_mysql | usuario_mysql |  |  |
| 23 | input | textbox | senha_mysql | senha_mysql |  |  |
| 24 | input | button |  | teste_mysql |  | Testar conexão |
| 29 | input | textbox | usuario_gerenciador | usuario_gerenciador |  |  |
| 33 | input | textbox | senha_gerenciador | senha_gerenciador |  |  |
| 37 | input | textbox | servidor_api_monitoramento | servidor_api_monitoramento |  |  |
| 41 | input | textbox | usuario_api_monitoramento | usuario_api_monitoramento |  |  |
| 45 | input | textbox | senha_api_monitoramento | senha_api_monitoramento |  |  |
| 50 | select | select | webservice_avaya_tipo | webservice_avaya_tipo |  |  |
| 56 | input | textbox | webservice_avaya | webservice_avaya |  |  |
| 60 | input | textbox | avaya_accs | avaya_accs |  |  |
| 64 | input | number | int_rediscagem | int_rediscagem |  |  |
| 70 | select | select | broker | broker |  |  |
| 78 | input | textbox | webhook | webhook |  |  |
| 79 | input | button |  | descobrir_webhook |  | Descobrir |
| 84 | input | textbox | sid_msg | sid_msg |  |  |
| 88 | input | textbox | token_msg | token_msg |  |  |
| 92 | input | textbox | sender_msg | sender_msg |  |  |
| 97 | input | textbox | pond_discador | pond_discador |  |  |
| 98 | input | number | price | pond_discador | 0 | 1 |
| 104 | textarea | textarea | localnet | localnet |  |  |
| 105 | input | button |  | descobrir_rede |  | Descobrir Rede |
| 109 | input | button |  |  |  | Gravar |

#### `app/dashboard.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 617 | input | checkbox |  |  |  |  |
| 621 | input | checkbox |  |  |  |  |
| 625 | input | checkbox |  |  |  |  |
| 629 | input | checkbox |  |  |  |  |
| 633 | input | checkbox |  |  |  |  |
| 637 | input | checkbox |  |  |  |  |
| 641 | input | checkbox |  |  |  |  |
| 645 | input | checkbox |  |  |  |  |
| 649 | input | checkbox |  |  |  |  |

#### `app/ddr.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `ddr`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/ddr.js`.

#### `app/destino.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | destino |
| 4 | input | text | dataini | flatedataini |  |  |
| 5 | input | submit |  |  |  | Listar |

#### `app/desvio.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `desvio`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/desvio.js`.

#### `app/download.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML.

#### `app/espera.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 7 | input | file | files[] |  |  |  |

#### `app/facilidades.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 8 | input | textbox | ddd | ddd |  |  |
| 9 | input | textbox | timeout | timeout |  |  |
| 10 | input | textbox | transferencia_cega | transferencia_cega |  |  |
| 11 | input | textbox | transferencia_assistida | transferencia_assistida |  |  |
| 12 | input | textbox | captura_grupo | captura_grupo |  |  |
| 13 | input | textbox | captura_ramal | captura_ramal |  |  |
| 14 | input | textbox | estacionar | estacionar |  |  |
| 15 | input | textbox | redisca | redisca |  |  |
| 16 | input | textbox | cancela_redisca | cancela_redisca |  |  |
| 17 | input | textbox | conferencia_convidar | conferencia_convidar |  |  |
| 18 | input | textbox | conferencia_unir | conferencia_unir |  |  |
| 19 | input | textbox | gravacao | gravacao |  |  |
| 20 | input | textbox | ouvir_ramal | ouvir_ramal |  |  |
| 22 | input | button |  |  |  | Gravar |

#### `app/fax.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de listagem/tabela sem formulário estático; entradas são tratadas por script. Scripts principais: `app/fax.js`.

#### `app/fax_envio.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 64 | input | text | fax | fax |  |  |
| 66 | input | text | email | email |  |  |
| 67 | input | file | fileToUpload | fileToUpload |  |  |
| 73 | input | button |  |  |  | Enviar |

#### `app/fax_rel.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | fax |
| 4 | input | text | dataini | faxdataini |  |  |
| 5 | input | text | datafim | faxdatafim |  |  |
| 7 | input | text | origem | faxorigem |  |  |
| 9 | input | text | destino | faxdestino |  |  |
| 10 | input | submit |  |  |  | Listar |

#### `app/faxweb.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela orientada a grid (jqGrid), com formulários de edição abertos dinamicamente (modal/inline). Título: `Results - R-IPABX - Sistema Integrado de Telefonia`. Scripts principais: `js/jquery.min.js`, `js/jquery.js`, `js/jquery-ui.min.js`, `js/jquery.ui.timepicker.js` (+18).

#### `app/feriado.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `feriado`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/feriado.js`.

#### `app/fila.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `fila`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/fila.js`.

#### `app/fila_abandonadas.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | fila_abandonadas |
| 4 | input | text | dataini | flnadataini |  |  |
| 5 | input | text | datafim | flnadatafim |  |  |
| 6 | select | select | filas | filas |  |  |
| 7 | input | submit |  |  |  | Listar |

#### `app/fila_agentes.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | fila_agentes |
| 4 | input | text | dataini | flagedataini |  |  |
| 5 | input | text | datafim | flagedatafim |  |  |
| 6 | select | select | filas | filas |  |  |
| 7 | input | submit |  |  |  | Listar |

#### `app/fila_atendidas.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | fila_atendidas |
| 4 | input | text | dataini | flnadataini |  |  |
| 5 | input | text | datafim | flnadatafim |  |  |
| 6 | select | select | filas | filas |  |  |
| 7 | input | submit |  |  |  | Listar |

#### `app/fila_hora.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | fila_hora |
| 4 | input | text | dataini | flatedataini |  |  |
| 5 | select | select | filas | filas |  |  |
| 6 | input | submit |  |  |  | Listar |

#### `app/filas_resumo.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 4 | input | hidden | prog | prog |  | filas_resumo |
| 5 | input | text | dataini | flatedataini |  |  |
| 6 | input | text | datafim | flatedatafim |  |  |
| 7 | select | select | filas | filas |  |  |
| 8 | input | submit |  |  |  | Listar |

#### `app/form.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | text | origem |  |  |  |
| 4 | input | text | ramal |  |  |  |
| 5 | input | text | opcao |  |  |  |
| 6 | input | submit |  |  |  | Submit |

#### `app/grupo.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `grupo`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/grupo.js`.

#### `app/hora.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | hora |
| 4 | input | text | dataini | flatedataini |  |  |
| 5 | input | submit |  |  |  | Listar |

#### `app/index.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 79 | input | search |  |  | Search... |  |

#### `app/index2.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela estrutural de navegação/layout do legado, com comportamento quase todo definido por scripts. Título: `Results - R-IPABX - Sistema Integrado de Telefonia`. Scripts principais: `js/jquery-1.7.2.min.js`, `js/jquery.js`, `js/jquery-ui.min.js`, `js/jquery.themeswitcher.js` (+23).

#### `app/index3.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela estrutural de navegação/layout do legado, com comportamento quase todo definido por scripts. Título: `Result's - R-IPABX`. Scripts principais: `js/jquery-1.11.0.min.js`, `js/jquery-ui.js`, `js/jquery.themeswitcher.js`, `js/jquery.ui.timepicker.js` (+22). Indício de fluxo visual/regras (ex.: jsPlumb/flow)..

#### `app/index_cc.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela estrutural de navegação/layout do legado, com comportamento quase todo definido por scripts. Título: `Results - R-IPABX - Sistema Integrado de Telefonia`. Scripts principais: `js/jquery.min.js`, `js/jquery.js`, `js/jquery-ui.min.js`, `js/jquery.themeswitcher.js` (+19).

#### `app/indexteste.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela estrutural de navegação/layout do legado, com comportamento quase todo definido por scripts. Título: `Results - R-IPABX - Sistema Integrado de Telefonia`. Scripts principais: `js/jquery.js`, `js/jquery-ui-1.8.10.custom.min.js`, `js/jquery.layout.js`, `js/i18n/grid.locale-pt-br.js` (+13).

#### `app/interconexao.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `interconexao`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/interconexao.js`.

#### `app/memorias.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `memorias.js`.

#### `app/menu.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela estrutural de navegação/layout do legado, com comportamento quase todo definido por scripts. Título: `Results - R-IPABX - Sistema Integrado de Telefonia`. Scripts principais: `js/jquery.js`, `js/jquery-ui-1.8.10.custom.min.js`, `js/jquery.layout.js`, `js/i18n/grid.locale-pt-br.js` (+13).

#### `app/mon_app.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `app` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_app.js`.

#### `app/mon_dependencies.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `dependencies` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_dependencies.js`.

#### `app/mon_hostgroups.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `hostgroups` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_hostgroups.js`.

#### `app/mon_hosts.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `hosts` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_hosts.js`.

#### `app/mon_notifications.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `notifications` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_notifications.js`.

#### `app/mon_os.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `os` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_os.js`.

#### `app/mon_servicegroups.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `servicegroups` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_servicegroups.js`.

#### `app/mon_services.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `services` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_services.js`.

#### `app/mon_timeperiods.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `timeperiods` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_timeperiods.js`.

#### `app/mon_usergroups.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `usergroups` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_usergroups.js`.

#### `app/mon_users.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `users` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_users.js`.

#### `app/mon_zones.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de monitoramento `zones` com dados carregados dinamicamente (predominantemente leitura). Scripts principais: `app/mon_zones.js`.

#### `app/motivo.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `motivo`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/motivo.js`.

#### `app/motivo1.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `motivo1`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/motivo1.js`.

#### `app/objetivos.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `objetivos.js`.

#### `app/operadoras.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `operadoras`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/operadoras.js`.

#### `app/origem.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | origem |
| 4 | input | text | dataini | flatedataini |  |  |
| 5 | input | submit |  |  |  | Listar |

#### `app/painel.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 46 | input | text | mensagem | mensagem |  |  |

#### `app/painel2.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Título: `Painel`. Cabeçalho visível: `5001`. Scripts principais: `https://cdn.jsdelivr.net/npm/bootstrap@5.2.0/dist/js/bootstrap.bundle.min.js`, `../vendors/bootstrap-5.2.0-dist/js/bootstrap.bundle.min.js`.

#### `app/palavras.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de listagem/tabela sem formulário estático; entradas são tratadas por script. Scripts principais: `palavras.js`.

#### `app/permissao.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML.

#### `app/pesquisa.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | pesquisa |
| 4 | input | text | dataini | flnadataini |  |  |
| 5 | input | text | datafim | flnadatafim |  |  |
| 6 | input | submit |  |  |  | Listar |

#### `app/ramais.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `ramais`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/ramais.js?v=2`.

#### `app/rchatbot.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 41 | input | text |  |  | Digite uma mensagem |  |

#### `app/rchatbot_chats.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de listagem/tabela sem formulário estático; entradas são tratadas por script. Scripts principais: `app/rchatbot_chats.js`.

#### `app/rchatbot_man.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 5 | select | text | tagSaudacao | tagSaudacao | tagSaudação |  |
| 11 | select | select | tagInicial | tagInicial | Tag Inicial |  |
| 19 | input | text | coeCerteza | coeCerteza | coeCerteza | 0.90000000 |
| 24 | select | select | tagIncerteza | tagIncerteza | Tag Incerteza |  |
| 29 | input | number | limiteIncerteza | limiteIncerteza | Limite Incerteza | 3 |
| 34 | select | select | tagTransbordo | tagTransbordo | Tag Transbordo |  |
| 38 | input | button |  |  |  | Gravar |

#### `app/recusa.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `recusa`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/recusa.js`.

#### `app/regras.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `regras.js`.

#### `app/resumo.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | resumo |
| 4 | input | text | dataini | resumodataini |  |  |
| 5 | input | text | datafim | resumodatafim |  |  |
| 7 | input | text | origem | resumoorigem |  |  |
| 9 | input | text | destino | resumodestino |  |  |
| 10 | input | submit |  |  |  | Listar |

#### `app/retorno.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `retorno`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/retorno.js`.

#### `app/rfone.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 41 | input | text | login_sipaccount | login_sipaccount | Login |  |
| 46 | input | password | login_sipsecret | login_sipsecret | Senha |  |
| 50 | input | submit |  | conectar |  | Conectar |
| 61 | input | text |  | number | Número |  |
| 98 | input | text |  | mensagem |  |  |
| 106 | input | text | settings-maxcalllogs |  | Enter	a	Number |  |
| 108 | input | checkbox | settings-log |  |  |  |
| 109 | input | text | settings-forcenumber |  | e.g.	127.0.0.1 |  |
| 118 | input | text | url | url |  |  |
| 127 | select | text | motivo | motivo |  |  |
| 139 | select | text | motivo1 | motivo1 |  |  |
| 146 | input | range |  | volume |  |  |

#### `app/rfone2.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 32 | input | text |  | mensagem |  |  |
| 43 | input | text |  | number |  |  |
| 74 | input | text | login-sipaccount | login-sipaccount |  |  |
| 75 | input | password | login-sipsecret | login-sipsecret |  |  |
| 82 | input | text | settings-host |  | IP or Hostname |  |
| 83 | input | text | settings-sipaccount |  | Name |  |
| 84 | input | password | settings-sipsecret |  |  |  |
| 88 | input | text | settings-maxcalllogs |  | Enter a Number |  |
| 90 | input | checkbox | settings-log |  |  |  |
| 91 | input | text | settings-forcenumber |  | e.g. 127.0.0.1 |  |
| 100 | select | text | motivo | motivo |  |  |
| 111 | select | text | motivo1 | motivo1 |  |  |

#### `app/ring.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial.

#### `app/rotas.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `rotas`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/rotas.js`.

#### `app/sac.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | input | hidden | prog | prog |  | sac |
| 4 | input | text | dataini | sacdataini |  |  |
| 5 | input | text | datafim | sacdatafim |  |  |
| 7 | input | text | origem | sacorigem |  |  |
| 9 | input | text | destino | sacdestino |  |  |
| 10 | input | submit |  |  |  | Listar |

#### `app/sac_rel.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de relatório/listagem; filtros e grid são montados dinamicamente pelo script da página. Scripts principais: `app/sac_rel.js`.

#### `app/sala.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `sala`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/sala.js`.

#### `app/server.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Título: `Cadastro de Ramais`. Scripts principais: `js/jquery.js`, `server.js`.

#### `app/servicos.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `app/servicos.js`.

#### `app/sip_config.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 10 | input | textbox | servidor | servidor |  |  |
| 14 | input | textbox | porta | porta |  |  |
| 18 | input | textbox | usuario | usuario |  |  |
| 22 | input | textbox | senha | senha |  |  |
| 26 | input | textbox | frase_teste | frase_teste |  |  |
| 29 | input | button |  |  |  | Gravar |

#### `app/sons.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 7 | input | file | files[] |  |  |  |

#### `app/substitutos.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `substitutos.js`.

#### `app/tab.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML. Scripts principais: `http://ajax.googleapis.com/ajax/libs/jquery/1.5/jquery.min.js`, `http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/jquery-ui.min.js`.

#### `app/temp/index.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela estrutural de navegação/layout do legado, com comportamento quase todo definido por scripts. Título: `URA Builder`. Cabeçalho visível: `URA Builder`. Scripts principais: `https://cdnjs.cloudflare.com/ajax/libs/jsPlumb/2.15.6/js/jsplumb.min.js`, `https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js`, `demo.js`. Indício de fluxo visual/regras (ex.: jsPlumb/flow)..

#### `app/term.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML. Título: `Mohamed Elgharbawy`. Scripts principais: `https://cdnjs.cloudflare.com/ajax/libs/xterm/3.14.5/xterm.min.js`.

#### `app/teste.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 19 | input | text | mensagem | mensagem |  |  |

#### `app/teste2.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML. Título: `teste`. Cabeçalho visível: `Teste`. Scripts principais: `js/jquery.min.js`, `js/jquery.min.js`, `js/jquery.mb.miniAudioPlayer.min.js`.

#### `app/teste3.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML. Título: `Bootstrap Example`. Cabeçalho visível: `Dynamic Tabs`. Scripts principais: `js/jquery.min.js`, `js/jquery-ui.min.js`, `js/bootstrap.min.js`.

#### `app/teste_painel.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 69 | input | text |  | message |  | Hello, world! |
| 71 | select | select |  | batch |  |  |

#### `app/teste_tree.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela orientada a grid (jqGrid), com formulários de edição abertos dinamicamente (modal/inline). Título: `jqTreeGrid - Load On Demand - Load all Rows at once collapsed`. Scripts principais: `js/jquery.min.js`, `js/jquery.jqGrid.min.js`, `js/i18n/grid.locale-en.js`.

#### `app/teste_ura.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML. Título: `Fluxo jsPlumb (Free) Dialplan Asterisk`. Cabeçalho visível: `Fluxo jsPlumb com Dialplan Asterisk (ES6)`. Scripts principais: `demo.js`. Indício de fluxo visual/regras (ex.: jsPlumb/flow)..

#### `app/tipo.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `tipo`, com edição dinâmica renderizada via JavaScript. Scripts principais: `tipo.js`.

#### `app/transbordo.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `transbordo`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/transbordo.js`.

#### `app/transferencia.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `transferencia`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/transferencia.js`.

#### `app/tron_clientes.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela orientada a grid (jqGrid), com formulários de edição abertos dinamicamente (modal/inline). Scripts principais: `js/jqgrid_odata.js`, `tron_clientes.js`, `tron_servicos.js`, `tron_palavras_base.js` (+1).

#### `app/tron_config.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 10 | input | textbox | servidor | servidor |  |  |
| 14 | input | textbox | porta | porta |  |  |
| 18 | input | textbox | cliente | cliente |  |  |
| 22 | input | textbox | senha | senha |  |  |
| 26 | input | textbox | servico | servico |  |  |
| 30 | input | textbox | avatar | avatar |  |  |
| 34 | input | textbox | avatar_cliente | avatar_cliente |  |  |
| 38 | input | textbox | saudacao | saudacao |  |  |
| 41 | input | button |  |  |  | Gravar |

#### `app/tron_dicionario.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `js/jqgrid_odata.js`, `tron_dicionario.js`.

#### `app/tron_palavras_base.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `js/jqgrid_odata.js`, `tron_palavras_base.js`.

#### `app/tron_palavras_sinonimos.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `js/jqgrid_odata.js`, `tron_palavras_sinonimos.js`.

#### `app/tron_substituidos.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `js/jqgrid_odata.js`, `tron_substituidos.js`.

#### `app/tron_substitutos.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela operacional com dados/ações conduzidos por JavaScript; não expõe formulário fixo no HTML inicial. Scripts principais: `js/jqgrid_odata.js`, `tron_substitutos.js`.

#### `app/tts.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 22 | textarea | textarea |  | text |  |  |
| 30 | input | file |  | audio-file |  |  |

#### `app/upload.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 35 | input | hidden | redirect |  |  | https://blueimp.github.io/jQuery-File-Upload/ |
| 43 | input | file | files[] |  |  |  |
| 57 | input | checkbox |  |  |  |  |

#### `app/upload2.html`

| Linha | Tag | Tipo | name | id | placeholder | valor/estado |
| ---: | --- | --- | --- | --- | --- | --- |
| 72 | input | hidden | redirect |  |  | https://blueimp.github.io/jQuery-File-Upload/ |
| 84 | input | file | files[] |  |  |  |
| 98 | input | checkbox |  |  |  |  |
| 214 | input | checkbox | delete |  |  | 1 |

#### `app/ura.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `ura`, com edição dinâmica renderizada via JavaScript. Cabeçalho visível: `URA Builder`. Scripts principais: `https://cdnjs.cloudflare.com/ajax/libs/jsPlumb/2.15.6/js/jsplumb.min.js`, `app/ura.js`. Indício de fluxo visual/regras (ex.: jsPlumb/flow)..

#### `app/ura1.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de listagem/tabela sem formulário estático; entradas são tratadas por script. Scripts principais: `ura.js`.

#### `app/usuarios.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela de manutenção/cadastro de `usuarios`, com edição dinâmica renderizada via JavaScript. Scripts principais: `app/usuarios.js`.

#### `app/xml.html`

_Sem campos de formulario no HTML estatico._

Explicacao: Tela sem campos estáticos no HTML. Título: `jQuery XML workbench`. Cabeçalho visível: `A few quotations for your enjoyment`. Scripts principais: `js/jquery.js`, `xml.js`.

## Tabela Unica de Execucao por Tela (HTML + JS + XML + PHP + CGI/JSS)

Legenda:
- Leitura: origem de dados para renderizacao/listagem.
- Escrita: endpoint PHP chamado para salvar/alterar.
- CGI/JSS final: destino legado efetivo (quando houver).

| Tela | HTML | JS | Leitura (XML/XSL/PHP) | Escrita (PHP) | CGI/JSS final |
| --- | --- | --- | --- | --- | --- |
| Assistencia | - (link direto menu) | `app/js/assistencia.js` | - | - | `/cgi/ripabx/assistencia.cgi?action=iniciar|finalizar` |
| Ramais | `app/ramais.html` | `app/ramais.js` | `xml.php`: `grupo.xml+grupo2.xsl`, `categoria.xml+categoria2.xsl`, `ramal.xml+ramal.xsl` | `app/server.php?prog=ramal` | `/cgi/ripabx/ramal_xml.cgi` |
| DDR | `app/ddr.html` | `app/ddr.js` | `xml.php`: `operadora.xml+operadora2.xsl`, `ddr.xml+ddr.xsl` | `app/server.php?prog=ddr` | `/cgi/ripabx/ddr_xml.cgi` |
| Grupos | `app/grupo.html` | `app/grupo.js` | `xml.php`: `grupo.xml+grupo.xsl` | `app/server.php?prog=grupo` | `/cgi/ripabx/grupo_xml.cgi` |
| Desvio | `app/desvio.html` | `app/desvio.js` | `xml.php`: `desvio.xml+desvio.xsl` | `app/server.php?prog=desvio` | `/cgi/ripabx/desvio_xml.cgi` |
| Transbordo | `app/transbordo.html` | `app/transbordo.js` | `xml.php`: `transbordo.xml+transbordo.xsl` | `app/server.php?prog=transbordo` | `/cgi/ripabx/transbordo_xml.cgi` |
| Bloqueio | `app/bloqueio.html` | `app/bloqueio.js` | `xml.php`: `bloqueio.xml+bloqueio.xsl` | `app/server.php?prog=bloqueio` | `/cgi/ripabx/bloqueio_xml.cgi` |
| Retorno | `app/retorno.html` | `app/retorno.js` | `xml.php`: `retorno.xml+retorno.xsl` | `app/server.php?prog=retorno` | `/cgi/ripabx/retorno_xml.cgi` |
| Recusa | `app/recusa.html` | `app/recusa.js` | `xml.php`: `recusa.xml+recusa.xsl` | `app/server.php?prog=recusa` | `/cgi/ripabx/recusa_xml.cgi` |
| Feriado | `app/feriado.html` | `app/feriado.js` | `xml.php`: `feriado.xml+feriado.xsl` | `app/server.php?prog=feriado` | `/cgi/ripabx/feriado_xml.cgi` |
| Transferencia | `app/transferencia.html` | `app/transferencia.js` | `xml.php`: `transferencia.xml+transferencia.xsl` | `app/server.php?prog=transferencia` | `/cgi/ripabx/transferencia_xml.cgi` |
| Fila | `app/fila.html` | `app/fila.js` | `xml.php`: `fila.xml+fila.xsl` | `app/server.php?prog=fila` | `/cgi/ripabx/fila_xml.cgi` |
| Motivo Pausa | `app/motivo.html` | `app/motivo.js` | `xml.php`: `motivo.xml+motivo.xsl` | `app/server.php?prog=motivo` | `/cgi/ripabx/motivo_xml.cgi` |
| Motivo Contato | `app/motivo1.html` | `app/motivo1.js` | `xml.php`: `motivo1.xml+motivo1.xsl` | `app/server.php?prog=motivo1` | `/cgi/ripabx/motivo1_xml.cgi` |
| Categoria | `app/categoria.html` | `app/categoria.js` | `xml.php`: `tipo.xml+tipo2.xsl`, `rota_base.xml+rota2.xsl`, `categoria.xml+categoria.xsl` | `app/server.php?prog=categoria` | `/cgi/ripabx/categoria_xml.cgi` |
| Sala | `app/sala.html` | `app/sala.js` | `xml.php`: `sala.xml+sala.xsl` | `app/server.php?prog=sala` | `/cgi/ripabx/sala_xml.cgi` |
| Interconexao | `app/interconexao.html` | `app/interconexao.js` | `xml.php`: `interconexao.xml+interconexao.xsl` | `app/server.php?prog=interconexao` | `/cgi/ripabx/interconexao_xml.cgi` |
| Fax (config) | `app/fax.html` | `app/fax.js` | `xml.php`: `fax.xml+fax.xsl` | `app/server.php?prog=fax` | `/cgi/ripabx/fax_xml.cgi` |
| Operadoras | `app/operadoras.html` | `app/operadoras.js` | `xml.php`: `operadora.xml+operadora.xsl` + `/cgi/ripabx/listalinks.cgi` + `/cgi/ripabx/listacanais.cgi` | `app/server.php?prog=operadora` | `/cgi/ripabx/operadora_xml.cgi` |
| Rotas | `app/rotas.html` | `app/rotas.js` | `xml.php`: `operadora.xml+operadora2.xsl`, `rota_base.xml+rota_base.xsl`, `rota.xml+rota.xsl` | `app/server.php?prog=rota_base|rota` | `/cgi/ripabx/rota_base_xml.cgi`, `/cgi/ripabx/rota_xml.cgi`, `cgi/ripabx/contexto.cgi?rota=` |
| Usuarios | `app/usuarios.html` | `app/usuarios.js` | `mysql*.php` (listagens) | `app/server2.php?prog=usuarios` | - |
| Campanhas | `app/campanha.html` | `app/campanha.js` | `mysql2.php/mysql3.php/mysql5.php` + `xml.php` de apoio | `app/server2.php?prog=campanha` | - |
| CallBack Agendado | `app/agendado.html` | `app/agendado.js` | `mysql*.php` + `xml.php` de apoio | `app/server2.php?prog=agendado` | - |
| CDR / Ligacoes | `app/cdr.html` | `app/cdr.js`, `app/js/exportagrid.js` | `app/cdr_rel.php` / `app/cdr_rel_dados.php` | - | `/cgi/cdr.cgi` (fluxos legados em `app/lista.js`) |
| Configuracoes | `app/configuracoes.html` | `app/configuracoes.js` | `app/xml2.php?xml=configuracoes.xml`, `app/ext_ip.php`, `app/localnet.php`, `app/teste_mysql.php` | `app/configuracoes.php` | `/cgi/ripabx/360dialog_get_webhook.jss` (`set_webhook.jss` comentado) |
| Licenca | `app/licenca.php` | `app/licenca.js` | `app/licenca2.php` + leitura local de licenca | `app/licenca2.php` | `/cgi/ripabx/licenca.cgi`, `/cgi/ripabx/checa_licenca.cgi` |
| Atualizacao | `app/update.php` | `app/js/progress.js` | `app/update_download.php` | `app/update_download.php` | `/cgi/ripabx/update.cgi` |

<!-- AUTO:REF_HTML_FIELDS:END -->
