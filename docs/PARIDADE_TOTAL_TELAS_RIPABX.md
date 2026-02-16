# Paridade Total de Telas RIPABX

Atualizado em: 2026-02-16

Objetivo: garantir cobertura **100%** do legado para todas as telas de referência.

## Padrão visual obrigatório

Todas as telas novas/modernizadas devem seguir o padrão de UX/UI da rota `/agents`:
- cabeçalho com ações primárias claras
- bloco de filtros em card (`bg-bg-elevated`, borda, sombra)
- campos com estilo consistente (input/select/checkbox)
- tabela principal com header destacado e ações por linha
- botões usando componente padrão `Button`

## Regra de aceite

Uma tela só é considerada concluída quando:
- status = `Total`
- campos de negócio equivalentes implementados
- regras/validações equivalentes implementadas
- operações equivalentes implementadas (CRUD, consultas, ações operacionais)
- integrações equivalentes (`.html`, `.js`, `.cgi`, `.xml`, `.php`) validadas

Status possíveis:
- `Total`: cobre completamente o legado
- `Parcial`: cobre parte (não aceito como final)
- `Nao iniciado`: sem cobertura suficiente no novo

## Matriz de cobertura por tela

| Legado | Referência | Novo (alvo) | Status | Gap crítico | Próxima ação |
|---|---|---|---|---|---|
| Inicio | `dash.html` | Dashboard (novo) | Parcial | validar KPIs equivalentes do legado | mapear KPIs 1:1 e fechar |
| Painel | `app/painel.html` | `frontend/src/pages/PbxPage.jsx` (overview) | Parcial | operação realtime do painel legado | fechar widgets e atualização |
| DDR | `app/ddr.html` | `frontend/src/pages/PbxPage.jsx` (`dids`) | Parcial | validações/regras do legado | mapear campos e validar persistência |
| Grupos | `app/grupo.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml` / futuro módulo) | Nao iniciado | CRUD dedicado de grupos | criar tab/módulo de grupos |
| Ramais | `app/ramais.html` | `frontend/src/pages/PbxPage.jsx` (`extensions`) | Parcial | faltam efeitos operacionais legados específicos (ex.: rotina equivalente ao gera_avaya) e homologação funcional ponta a ponta | fechar efeitos + homologação |
| Desvio | `app/desvio.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml` / `ivr`) | Nao iniciado | regras de desvio não modeladas 1:1 | criar módulo dedicado |
| Transbordo | `app/transbordo.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml`) | Nao iniciado | regras de overflow não modeladas | implementar regra + UI |
| Bloqueio | `app/bloqueio.html` | `frontend/src/pages/PbxPage.jsx` (`acls` + `legacyXml`) | Parcial | bloqueios do legado além de ACL | completar regras e CRUD |
| Retorno | `app/retorno.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml`) | Nao iniciado | sem fluxo funcional dedicado | implementar fluxo de retorno |
| Recusa | `app/recusa.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml`) | Nao iniciado | regras de recusa não implementadas | implementar regras + persistência |
| Feriado | `app/feriado.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml` / `ivr`) | Nao iniciado | ausência de calendário/roteamento | criar módulo de feriados |
| Transferencia | `app/transferencia.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml`) | Nao iniciado | políticas de transferência ausentes | implementar políticas |
| Audios Espera | `app/upload.html?dir=espera` | `frontend/src/pages/PbxPage.jsx` (`media`) | Parcial | gestão completa de diretório legado | adicionar operação por diretório |
| Audios Sons | `app/upload.html?dir=sons` | `frontend/src/pages/PbxPage.jsx` (`media`) | Parcial | gestão completa de diretório legado | adicionar operação por diretório |
| Ligações (CDR) | `app/cdr.html` | `frontend/src/pages/PbxPage.jsx` (`cdr`) | Parcial | filtros/exports equivalentes | fechar filtros e exportação |
| Fax (rel) | `app/fax_rel.html` | módulo novo (a criar) | Nao iniciado | relatório fax ausente | implementar relatório |
| Gravacoes | `app/sac.html` | `frontend/src/pages/PbxPage.jsx` (`recordings`) | Parcial | recursos operacionais do legado | fechar funcionalidades faltantes |
| Resumo | `app/resumo.html` | módulo novo (Analytics/relatórios) | Nao iniciado | relatório legado ausente | implementar relatório |
| Hora | `app/hora.html` | módulo novo (Analytics/relatórios) | Nao iniciado | relatório legado ausente | implementar relatório |
| Origem | `app/origem.html` | módulo novo (Analytics/relatórios) | Nao iniciado | relatório legado ausente | implementar relatório |
| Destino | `app/destino.html` | módulo novo (Analytics/relatórios) | Nao iniciado | relatório legado ausente | implementar relatório |
| Configurações | `app/configuracoes.html` | `frontend/src/pages/ConfigPage.jsx` | Parcial | ainda sem equivalência 1:1 validada | mapear campos e fechar gaps |
| Operadoras | `app/operadoras.html` | `frontend/src/pages/PbxPage.jsx` (`routes`/`trunks`/`legacyXml`) | Parcial | modelo legado de operadora | completar mapeamento |
| Rotas | `app/rotas.html` | `frontend/src/pages/PbxPage.jsx` (`routes`) | Parcial | regras base/rota do legado | implementar regras faltantes |
| Categoria | `app/categoria.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml`) | Nao iniciado | CRUD dedicado inexistente | criar CRUD dedicado |
| Fax | `app/fax.html` | módulo novo (a criar) | Nao iniciado | configuração fax ausente | implementar módulo |
| Facilidades | `app/facilidades.html` | módulo novo (a criar) | Nao iniciado | facilidades não implementadas | implementar módulo |
| URA | `app/ura.html` | `frontend/src/pages/PbxPage.jsx` (`ivr`) | Parcial | paridade de editor/regras legado | completar comportamentos |
| Sala | `app/sala.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml`) | Nao iniciado | CRUD dedicado inexistente | criar CRUD dedicado |
| Interconexao | `app/interconexao.html` | `frontend/src/pages/PbxPage.jsx` (`legacyXml`) | Nao iniciado | CRUD dedicado inexistente | criar CRUD dedicado |
| Usuarios | `app/usuarios.html` | `frontend/src/pages/AgentsPage.jsx` / `frontend/src/pages/TenantsPage.jsx` | Parcial | compatibilidade completa com legado | fechar regras e perfis |
| Rede | `config/net` | módulo novo (admin infra) | Nao iniciado | não implementado no novo | criar módulo ou externalizar |
| DHCP | `config/dhcpd` | módulo novo (admin infra) | Nao iniciado | não implementado no novo | criar módulo ou externalizar |
| Firewall | `config/firewalld` | módulo novo (admin infra) | Nao iniciado | não implementado no novo | criar módulo ou externalizar |
| VPN | `config/ipsec` | módulo novo (admin infra) | Nao iniciado | não implementado no novo | criar módulo ou externalizar |
| Licenca | `app/licenca.php` | módulo novo (a criar) | Nao iniciado | fluxo licenciamento ausente | implementar módulo |
| Atualizacao | `app/update.php` | módulo novo (a criar) | Nao iniciado | fluxo atualização ausente | implementar módulo |
| Assistencia | `/cgi/ripabx/assistencia.cgi` | módulo novo (a criar) | Nao iniciado | operação de assistência ausente | implementar integração |
| Recarga | `app/recarga.php` | módulo novo (a criar) | Nao iniciado | operação recarga ausente | implementar integração |
| Fila | `app/fila.html` | `frontend/src/pages/PbxPage.jsx` (`queues`) | Parcial | falta cobertura dos relatórios legados da fila e homologação operacional ponta a ponta | fechar relatórios + homologação |
| Motivo Pausa | `app/motivo.html` | `frontend/src/pages/PbxPage.jsx` (`ccPauseReasons`) | Parcial | validar equivalência 1:1 | mapear campos finais |
| Motivo Contato | `app/motivo1.html` | `frontend/src/pages/PbxPage.jsx` (`ccContactReasons`) | Parcial | validar equivalência 1:1 | mapear campos finais |
| Campanhas | `app/campanha.html` | `frontend/src/pages/PbxPage.jsx` (`ccCampaigns`) | Parcial | regras legadas completas | fechar regras/validações |
| CallBack Agendado | `app/agendado.html` | `frontend/src/pages/PbxPage.jsx` (`ccScheduled`) | Parcial | paridade de regras/status | fechar paridade |
| Relatório atendidas | `app/fila_atendidas.html` | módulo novo (relatórios CC) | Nao iniciado | relatório dedicado ausente | implementar |
| Relatório abandonadas | `app/fila_abandonadas.html` | módulo novo (relatórios CC) | Nao iniciado | relatório dedicado ausente | implementar |
| Relatório agentes | `app/fila_agentes.html` | módulo novo (relatórios CC) | Nao iniciado | relatório dedicado ausente | implementar |
| Relatório por hora | `app/fila_hora.html` | módulo novo (relatórios CC) | Nao iniciado | relatório dedicado ausente | implementar |
| Resumo por campanha | `app/filas_resumo.html` | módulo novo (relatórios CC) | Nao iniciado | relatório dedicado ausente | implementar |
| Pesquisa | `app/pesquisa.html` | módulo novo (relatórios CC) | Nao iniciado | relatório dedicado ausente | implementar |
| Click2Call | `app/click2call.php` | `frontend/src/pages/PbxPage.jsx` (`ccClick2Call`) | Parcial | validar todos os campos/fluxos do legado | fechar paridade |

## Priorização de execução (ordem sugerida)

1. PBX core de maior impacto: `ramais`, `ddr`, `fila`, `rotas`, `ura`, `cdr`, `gravacoes`.
2. Contact Center operacional: `motivo`, `motivo1`, `campanha`, `agendado`, `click2call`.
3. Relatórios legados (PBX + CC): `resumo`, `hora`, `origem`, `destino`, relatórios de fila.
4. Administração/infra: `config/*`, `licenca`, `update`, `assistencia`, `recarga`.

## Critério de encerramento do programa

- 100% das linhas da matriz com `Status = Total`.
- evidência de validação funcional por tela anexada ao checklist de QA.
- ausência de regressões críticas nos fluxos já entregues.
