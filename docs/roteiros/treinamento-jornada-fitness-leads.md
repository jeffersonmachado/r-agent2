# Treinamento — Fitness Matrícula (Captação de Lead via WhatsApp) via Replay

> Gerado a partir do replay real `qa_wave_replay_1784735269633_nkhthn` (execução `meshq-1784735269632-0rsztq`, 2026-07-22T15:47:49Z, status **passed**, duração 27,1s).
> Público-alvo: novos usuários da plataforma RAP. Dificuldade: intermediário. Duração estimada: 5 min.

## 1. Objetivo do treinamento

Ao final deste roteiro o usuário deve ser capaz de:

1. Abrir e assistir ao replay da jornada `fitness-matricula-leads` na interface web.
2. Entender o que cada um dos 7 passos do replay valida no fluxo de captação de lead via WhatsApp.
3. Interpretar o resultado da execução (passou/falhou) e saber onde procurar evidências.
4. Tirar dúvidas sobre a jornada usando a base de conhecimento (RAG) da plataforma.

## 2. O que é o replay

O replay é a gravação determinística de uma execução real do cenário **Fitness Matrícula — Captação de Lead via WhatsApp**, produzida pelo QA Mesh/Waves. Ele registra cada passo da jornada (evento → validação) com timestamps, permitindo assistir à jornada passo a passo sem reexecutar nada.

- **Cenário**: `fitness-matricula-leads` (domínio omnichannel, tipo e2e, criticidade standard, adapter RPA).
- **Replay de referência**: `qa_wave_replay_1784735269633_nkhthn`.
- **Evidências de browser** (11 screenshots + relatório): `AI_MEMORY/evidence/qa-waves/browser-run-2026-07-22T15-46-55-336Z/`.

## 3. Como assistir ao replay na UI

1. Acesse `http://localhost:5173` e faça login (QA local: usuário `systemadmin`, senha `Admin123!`, tenant `system`).
2. Abra diretamente a listagem de replays filtrada:
   `http://localhost:5173/dev/rpa-replays?search=qa_wave_replay_1784735269633_nkhthn`
   (Não use `?source=qa-waves` — a listagem não filtra por origem; use `?search=` com o id do replay.)
3. Clique no replay na lista para abrir o modal de detalhe.
4. No modal, use o botão **Play** para rodar o playback dos passos gravados e inspecione a timeline **ANTES/DEPOIS** de cada passo.
5. Alternativa: na página **QA Waves Integrado** (`/dev/qa-waves`), selecione a jornada `fitness/leads` e o cenário `fitness-matricula-leads` para executar um novo replay ao vivo.

> **Acompanhamento em tempo real**: o progresso da execução (cenário iniciado, cada ação do RPA, finalização) chega à UI por **WebSocket** — não há polling nem necessidade de recarregar a página. O mesmo vale para a página QA Mesh (`/dev/qa-mesh`) e para a execução de seeds em `/dev/rpa-seeds`.

### 3.1 Passo a passo das telas da UI no replay (uiTrace)

Além dos 7 passos semânticos da jornada, o replay grava o **passo a passo das telas reais** executadas pelo RPA no browser (campo `uiTrace` do replay JSON). No modal de detalhe esses passos aparecem marcados com 🖥️ e cada um mostra:

- a **ação** executada (`navigate`, `click`, `fill`, `wait`, `assert`) e o **seletor** usado;
- o **valor preenchido** em campos de formulário (linha "📝 Valor preenchido"), ex.: o texto digitado na busca de replays;
- os **screenshots ANTES e DEPOIS** da tela em cada passo, embutidos no próprio replay;
- o resultado do passo (sucesso/falha) e o erro, quando houver.

A sequência de telas gravada pelo cenário de referência (`rpa/seeds/fitness-matricula-leads.json` v1.5.x) é:

| # | Ação | Tela/alvo |
|---|---|---|
| 1 | navigate | `/dev/qa-waves` (login automático UI como super-admin + seleção do tenant `system`) |
| 2 | wait | título "QA Waves Integrado" visível |
| 3 | click | jornada **Leads** (visão inicial) |
| 4 | wait | painel da jornada |
| 5 | click | aba **Cenários** |
| 6 | wait | aba pronta |
| 7 | click | jornada **Leads** na aba Cenários (o filtro de jornada é por aba) |
| 8 | wait | lista de cenários da jornada |
| 9 | click | cenário `fitness-matricula-leads@...` |
| 10 | wait | detalhe do cenário |
| 11 | navigate | `/dev/rpa-replays` |
| 12 | wait | listagem de replays pronta |
| 13 | fill | campo de busca preenchido com `qa_wave_replay` |
| 14 | wait | lista filtrada |
| 15 | assert | página contém o replay |

É esta trilha que deve ser usada no treinamento de "como preencher as telas": o usuário vê, tela a tela, onde clicar e o que digitar.

## 4. Os 7 passos da jornada (o que cada um valida)

| # | Passo | O que valida | Componente | Timeout |
|---|---|---|---|---|
| 1 | Envio de Mensagem | Cliente envia mensagem WhatsApp pedindo informações sobre matrícula | whatsapp | 15s |
| 2 | Evento de Canal | Sistema recebe o evento inbound do WhatsApp | whatsapp | 10s |
| 3 | Validação de Intenção (IA) | IA classifica a intenção do cliente (matrícula/lead) | aiIntentService | 15s |
| 4 | Transição de Fluxo | Sistema decide o roteamento: bot ou atendimento humano | flowEngine | 10s |
| 5 | Resposta | Bot gera e envia a resposta ao cliente (com apoio do RAG) | ragService | 15s |
| 6 | Backend | Lead é criado/persistido no backend | api | 15s |
| 7 | SLA | SLA de primeira resposta ao lead é respeitado | meshValidator | 15s |

Na execução de referência, todos os 7 passos foram concluídos em 27,1s, sem erros, com a asserção `execução RPA seed concluída sem erro crítico`.

## 5. Como interpretar o resultado

- **Status `passed`** no cenário = a jornada executou todos os passos sem erro crítico.
- **GO/NO_GO de governança**: o cenário `leads` não é "blocking", portanto o NO_GO estrutural do relatório de governança refere-se à ausência de provas de browser obrigatórias para jornadas bloqueantes — não a uma falha desta jornada. Consulte `qa-mesh/go-no-go-report.json` e `npm run validate:qa-governance`.
- **Contrato de snapshots de estado**: a jornada `leads` possui contrato em `config/state-snapshot-contracts.json` (8 snapshots validados, coletor em `api/services/qa/stateSnapshotService.js`).
- **Onde estão os artefatos**:
  - Replay JSON: `qa-mesh/meshEvidence/<executionId>/replays/fitness-matricula-leads.json`
  - Resultado do cenário: `qa-mesh/meshEvidence/<executionId>/scenarios/fitness-matricula-leads.json`
  - Screenshots do ciclo browser: `AI_MEMORY/evidence/qa-waves/browser-run-<ts>/`

## 6. Perguntas frequentes (base de conhecimento)

**Como executo o cenário fitness-matricula-leads?**
Login no frontend → `/dev/qa-waves` → selecionar jornada `fitness/leads` → selecionar cenário `fitness-matricula-leads` → Executar. A execução retorna HTTP 202 com `executionId` e `replayId` e leva ~30s.

**Onde vejo o replay da jornada?**
Em `/dev/rpa-replays?search=<replayId>` (ex.: `qa_wave_replay_1784735269633_nkhthn`), clicando no item da lista e usando o botão Play do modal.

**O que significa cada passo do replay?**
Ver a tabela da seção 4: envio WhatsApp → evento inbound → classificação de intenção por IA → decisão de roteamento → resposta do bot → criação do lead no backend → verificação de SLA.

**Consigo ver o preenchimento das telas, clique a clique?**
Sim. Os passos marcados com 🖥️ no modal do replay (seção 3.1) mostram cada ação do RPA na interface real — navegação, cliques nas abas Cenários/Leads, valor digitado na busca — com screenshot da tela antes e depois de cada ação.

**O progresso da execução atualiza sozinho na tela?**
Sim. O acompanhamento é em tempo real via WebSocket (eventos `qa-waves.execution.updated`, `rpa.execution.updated`): o status muda de "processando" para "concluído/falhou" sem recarregar a página e sem polling.

**O cenário passou mas a governança está NO_GO. Por quê?**
O NO_GO é estrutural: faltam provas de browser para jornadas classificadas como "blocking". A jornada `leads` não é blocking; seu cenário consta como `passed`. Verifique `qa-mesh/go-no-go-report.json`.

**Onde estão as evidências (screenshots) da execução?**
Em `AI_MEMORY/evidence/qa-waves/browser-run-<timestamp>/`, incluindo `run-report.json` com ids, URLs finais, erros de console e falhas de rede.

**Quais são os pré-requisitos para executar a jornada?**
API na porta 3001, frontend Vite na 5173, Redis e PostgreSQL acessíveis, credenciais de QA (`systemadmin`/`Admin123!`, tenant `system`) e Playwright disponível para o replay RPA.

**Este roteiro responde dúvidas automaticamente?**
Sim — este documento foi ingerido na base de conhecimento (RAG) da plataforma. Perguntas como "como executar o cenário fitness-matricula-leads?" podem ser feitas diretamente ao assistente com RAG, que responde com base neste conteúdo.

## 7. Validações de governança relacionadas

```bash
npm run validate:qa-governance     # QA Mesh GO/NO_GO
npm run validate:replay-governance # Integridade de replay
npm run qa:mesh                    # Malha canônica de cenários
```
