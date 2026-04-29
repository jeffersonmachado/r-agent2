# QA Waves — Análise da Tela, Duplicidades e Roteiros por Jornada

> Gerado com base em análise do código-fonte (`journeyRegistry.js`, `meshRegistry.json`, `scenario-store.json`) e inspeção visual da tela `/dev/qa-waves`.

---

## 1. Estrutura da Tela

A tela `/dev/qa-waves` possui **duas abas** principais:

| Aba | Finalidade |
|-----|-----------|
| **Jornadas e Cenários** | Árvore hierárquica de domínios → jornadas → passos → sub-jornadas → cenários |
| **Cobertura e Gaps** | Métricas de cobertura por vertical/jornada, análise de gaps com IA |

### Painel esquerdo — Árvore de Jornadas

Lista todos os domínios e jornadas com indicador de status visual (GO / WARNING):

| Domínio | Jornada | Status |
|---------|---------|--------|
| FITNESS | Cliente Novo | GO (verde) |
| FITNESS | Cliente Ativo | WARNING |
| BEAUTY | Cliente Novo | WARNING |
| BEAUTY | Cliente Recorrente | WARNING |
| PBX | Serviço de Voz | WARNING |
| PBX | Operação PBX | WARNING |
| CORE | Jornada Core | WARNING |
| UNMAPPED | Não Mapeado | WARNING |
| CLINIC | Clinic Customer Journey | GO (verde) |
| FOOD | Food Customer Journey | WARNING |
| MERCADO | Unmapped Journey | WARNING |
| SERVICES | Services Customer Journey | WARNING |
| BPMN | Bpmn Editor Journey | WARNING |
| OMNICHANNEL | Omnichannel Operations | WARNING |

### Painel direito — Detalhe da Jornada Selecionada

Ao selecionar uma jornada, exibe:
- Resumo consolidado (total de itens, críticos, % cobertura)
- Execuções reais QA Waves (com filtro por data)
- Cards de passos (ex.: Engajamento, Pagamento) com status e cenários
- Seção de cenários semânticos e seeds (IA + manual)
- Editor guiado de cenário (dados gerais, passos semânticos, seeds)

---

## 2. Arquitetura de Dados

### Como as jornadas são construídas

O endpoint `GET /api/qa-waves/journeys` executa `buildJourneyRegistry()` em `journeyRegistry.js`, que:

1. Parte de 5 domínios fixos no `JOURNEY_BLUEPRINTS` (fitness, beauty, pbx, core, unmapped)
2. Para cada um dos **50 cenários do `meshRegistry.json`**, infere via keyword matching:
   - `domainId` → por prefixo ou palavra-chave no ID do cenário
   - `journeyId` → por keywords mais específicas (ex.: `renew` → `fitness_active_customer`)
   - `stepId` → por keywords (ex.: `payment` → `step_10_payment`)
   - `subJourneyId` → por keywords de sub-jornada
3. Cria dinamicamente os 6 domínios restantes (clinic, food, mercado, services, bpmn, omnichannel) via `ensureDomain()`

> **Ponto crítico:** O mapeamento é baseado em **inferência por palavras-chave**, não em campos explícitos. Cenários sem keyword reconhecível caem no fallback `step_03_engagement`.

---

## 3. Duplicidades Encontradas

### 3.1 Cenário duplicado no `scenario-store.json` ⚠️ ALTA PRIORIDADE

**Arquivo:** `qa/qa-waves/scenario-store.json`

O cenário `fitness_trial_class` ("Aula experimental") aparece **duas vezes** com o mesmo `id`:

| Campo | Entrada 1 | Entrada 2 |
|-------|-----------|-----------|
| `id` | `fitness_trial_class` | `fitness_trial_class` |
| `status` | `approved` | `active` |
| `version` | `v2` | (sem versão) |
| `source` | `ai_inferred` | `ai_inferred` |

**Impacto:** O front-end pode renderizar o mesmo cenário duas vezes na listagem de cenários semânticos. As execuções podem processar o cenário em duplicidade.

**Correção recomendada:** Remover a entrada com `status: "active"` (mais antiga, sem versão) ou migrar seu status para a entrada com `status: "approved"`.

---

### 3.2 Quinze cenários RPA com nome idêntico ⚠️ MÉDIA PRIORIDADE

**Arquivo:** `qa-mesh/meshRegistry.json`

11 cenários no domínio **OMNICHANNEL** e 4 no domínio **PBX** compartilham o mesmo valor no campo `flow`:

```
"flow": "IA - Teste RPA - studiooly"
```

| Domínio | Quantidade | IDs |
|---------|-----------|-----|
| OMNICHANNEL | 11 | `rpa-test-flow-28d2aea0-...` até `rpa-test-flow-da6f66c1-...` |
| PBX | 4 | `rpa-test-flow-659d7749-...` até `rpa-test-flow-a85c4a4d-...` |

Cada um tem um `rpaRecordingId` distinto (gravações reais diferentes), portanto **não são duplicatas funcionais** — são gravações RPA distintas geradas pelo módulo RPA com o mesmo nome padrão.

**Impacto:** Na UI, todos aparecem com o mesmo rótulo "IA - Teste RPA - studiooly", tornando impossível distinguir qual gravação é qual sem ver o ID interno. Dificulta debugging e análise de falhas.

**Correção recomendada:** Ao gravar via RPA com fonte IA, usar o nome da gravação ou o prefixo do tenant como parte do `flow`. Ex.: `"IA - Teste RPA - studiooly (fluxo login)"`.

---

### 3.3 Dois tenants com nome idêntico no seletor ⚠️ BAIXA PRIORIDADE

**Origem:** Modal "Selecione o Tenant" na tela

Dois tenants aparecem com o mesmo nome de exibição **"Results QA"**:

| Nome | ID interno | Tipo |
|------|-----------|------|
| Results QA | `results-qa-2` | Trial |
| Results QA | `results-qa` | Trial |

**Impacto:** O usuário não consegue distinguir qual tenant selecionar sem inspecionar os IDs internos. Pode causar execuções no tenant errado.

**Correção recomendada:** Atualizar o nome de exibição de um deles (ex.: "Results QA (legacy)" ou "Results QA 2").

---

### 3.4 Domínio UNMAPPED duplica o conceito de MERCADO ⚠️ INFORMACIONAL

Na árvore de jornadas:
- **UNMAPPED > Não Mapeado** — domínio de fallback para cenários sem keyword
- **MERCADO > Unmapped Journey** — domínio dinâmico criado para `business-market-scr-01`

O nome "Unmapped Journey" no MERCADO é gerado automaticamente por `toNameFromId('market_customer_journey')`, que não tem tradução para "Marketplace" nem "Mercado". Não é uma duplicata funcional, mas o nome é confuso.

**Correção recomendada:** Adicionar `market` ao `JOURNEY_BLUEPRINTS` com nome explícito "Mercado" e journeyId `market_customer_journey`.

---

### 3.5 Domínios dinâmicos sem blueprint fixo ⚠️ INFORMACIONAL

Os 6 domínios criados dinamicamente (CLINIC, FOOD, MERCADO, SERVICES, BPMN, OMNICHANNEL) não estão no `JOURNEY_BLUEPRINTS` do `journeyRegistry.js`. Isso significa que:

- Seus nomes são gerados via `toNameFromId()` (ex.: `omnichannel` → "Omnichannel"), podendo divergir do nome esperado
- Qualquer mudança de keyword no ID do cenário pode mudar o domínio ao qual ele pertence
- Não existe validação de cobertura esperada para esses domínios

---

### 3.6 Campo `journey` ausente em todos os cenários do `meshRegistry.json`

Nenhum dos 50 cenários do `meshRegistry.json` possui o campo `journey`. O mapeamento é feito exclusivamente por inferência de keywords no ID. Isso é design intencional (o `journeyRegistry.js` faz essa inferência), mas cria fragilidade: renomear um cenário pode mudar silenciosamente a jornada a que ele pertence.

---

## 4. Roteiros por Jornada

Os roteiros abaixo descrevem, em linguagem humana, o que cada jornada valida, como executá-la e o que verificar.

---

### JORNADA 1: FITNESS — Cliente Novo

**Objetivo:** Validar o ciclo completo de aquisição de um novo aluno de academia: desde o primeiro contato via WhatsApp/chat até o pagamento e ativação do plano.

**Pré-condições:**
- Tenant fitness configurado com planos ativos
- Sandbox de billing habilitado
- Agenda com horários disponíveis

**Passos do roteiro:**

1. **Engajamento via canal (WhatsApp/chat)**
   - O usuário envia uma mensagem expressando interesse (ex.: "Quero fazer uma aula experimental", "Tem aula teste?")
   - O sistema deve reconhecer a intenção `trial_interest` com confiança ≥ 0.7
   - O bot deve responder com oferta de aula experimental (validar semanticamente via RAG)

2. **Captação de dados do lead**
   - O sistema solicita nome, telefone e objetivo do aluno
   - Preencher com dados da seed (ex.: seed_001: Ana Souza, +5511991110001, emagrecimento)
   - Verificar que os dados são persistidos corretamente

3. **Verificação de disponibilidade**
   - O sistema consulta a agenda para o tipo de aula solicitado (funcional, yoga, etc.)
   - Deve retornar horários disponíveis no horário preferido do aluno (ex.: 18:00)

4. **Seleção de horário e agendamento**
   - O aluno seleciona o slot disponível
   - O sistema cria o booking no backend
   - Verificar que `backendEntity: "booking"` existe com `backendExists: true`

5. **Confirmação**
   - O bot envia confirmação semântica do agendamento
   - Validar que a confirmação contém referência ao horário e tipo de aula

6. **Validação de SLA**
   - Todo o fluxo deve completar em ≤ 15.000 ms
   - Verificar que o fallback não foi acionado (`fallbackTriggered: false`)

7. **Cadastro formal e ativação**
   - Executar `business-f1` via pipeline: `node core/rpa/cli.js business --mode=journeys --code=F1`
   - Assertions: aluno criado, plano aplicado, cobrança gerada, pagamento reconhecido, status ativo, reflexo em check-in e financeiro

8. **Smoke de telas**
   - `business-fit-scr-01`: tela Students carrega corretamente
   - `business-fit-scr-02`: tela Memberships exibe plano ativo
   - `business-fit-scr-03`: tela Attendance registra check-in

**Cenários envolvidos:**
- `business-f1` — novo aluno até pagamento e ativação (blocking)
- `business-fit-flow-student` — cadastro e salvamento
- `business-fit-flow-charge` — geração de cobrança
- `fitness_trial_class@v2` — cenário semântico IA (seeds 001–005)
- `business-fit-scr-01`, `business-fit-scr-02`, `business-fit-scr-03` — smoke de telas

**O que verificar após execução:**
- Status GO com 100% sucesso
- Cobertura de execução ≥ 80%
- Nenhuma falha crítica em blocking

---

### JORNADA 2: FITNESS — Cliente Ativo

**Objetivo:** Validar os fluxos de um aluno já cadastrado: renovação/rematrícula, check-in, atendimento recorrente.

**Pré-condições:**
- Aluno existente seeded no banco de dados
- Plano vencido ou próximo do vencimento (para renovação)
- Agenda com check-in habilitado

**Passos do roteiro:**

1. **Renovação / Rematrícula**
   - Executar `business-f2` via `node core/rpa/cli.js business --mode=journeys --code=F2`
   - O sistema deve criar nova cobrança sem duplicação
   - Verificar: nova cobrança criada, pagamento confirmado, sem duplicação indevida, status mantido

2. **Check-in e Controle de Acesso**
   - Executar `business-fit-flow-checkin`
   - O aluno registra presença (via catraca ou app)
   - Verificar que o evento de check-in é registrado corretamente

3. **Geração de cobrança avulsa**
   - Executar `business-fit-flow-charge`
   - Simular cobrança de produto/serviço adicional
   - Verificar: cobrança criada, pagamento isolado reconhecido

**Cenários envolvidos:**
- `business-f2` — renovação/rematrícula (criticality: high)
- `business-fit-flow-checkin` — check-in e controle de acesso
- `business-fit-flow-charge` — geração de cobrança

**O que verificar após execução:**
- Não há duplicação de cobranças
- Status do aluno mantido como ativo
- Check-in refletido em relatório financeiro/frequência

---

### JORNADA 3: BEAUTY — Cliente Novo

**Objetivo:** Validar o ciclo de captação de cliente em salão de beleza: campanha → lead → agendamento → pagamento.

**Pré-condições:**
- Campanha ativa no sistema (ex.: promoção de unhas)
- Sandbox de billing habilitado
- Agenda de serviços configurada

**Passos do roteiro:**

1. **Campanha e atração**
   - Executar `business-b1` via `node core/rpa/cli.js business --mode=journeys --code=B1`
   - Simular campanha de unhas com preço promocional
   - Verificar: campanha criada, lead captado

2. **Conversão do lead**
   - O lead recebe comunicação da oferta
   - Executa `business-beauty-flow-lead`
   - Verificar: lead convertido em cliente

3. **Agendamento de serviço**
   - Executar `business-beauty-flow-appointment`
   - O cliente seleciona horário e profissional
   - Verificar: agendamento válido no sistema

4. **Pagamento com preço promocional**
   - Executar `business-beauty-flow-payment`
   - Verificar: preço promocional da campanha aplicado, pagamento confirmado

5. **Smoke de telas**
   - `business-beauty-scr-01`: tela Campaigns exibe a campanha ativa
   - `business-beauty-scr-02`: tela Leads lista o lead captado
   - `business-beauty-scr-03`: tela Customers mostra cliente convertido
   - `business-beauty-scr-04`: tela Schedule exibe agendamento

**Cenários envolvidos:**
- `business-b1` — campanha de unhas até pagamento (blocking)
- `business-beauty-flow-campaign`, `business-beauty-flow-lead`, `business-beauty-flow-appointment`, `business-beauty-flow-payment`
- `business-beauty-scr-01` a `business-beauty-scr-04`

**O que verificar após execução:**
- Preço promocional aplicado corretamente
- Sem duplicação de leads ou agendamentos
- Telas carregando sem erro

---

### JORNADA 4: BEAUTY — Cliente Recorrente

**Objetivo:** Validar o fluxo de reagendamento de um cliente existente no salão.

**Pré-condições:**
- Agendamento existente seeded no banco de dados
- Cliente com histórico de visitas

**Passos do roteiro:**

1. **Localizar agendamento existente**
   - O sistema deve identificar o agendamento do cliente pelo telefone/nome
   - Verificar: agendamento localizado com horário e serviço corretos

2. **Alterar horário**
   - Executar `business-b2` via `node core/rpa/cli.js business --mode=journeys --code=B2`
   - Selecionar novo horário disponível
   - Verificar: horário alterado, consistência do agendamento mantida

3. **Smoke de serviços e pagamentos**
   - `business-beauty-scr-05`: tela Services lista os serviços disponíveis
   - `business-beauty-scr-06`: tela Payments exibe histórico do cliente

**Cenários envolvidos:**
- `business-b2` — reagendamento (criticality: high)
- `business-beauty-scr-05`, `business-beauty-scr-06`

**O que verificar após execução:**
- O reagendamento não cria duplicata
- O horário original é liberado na agenda
- Histórico do cliente atualizado

---

### JORNADA 5: PBX — Serviço de Voz

**Objetivo:** Validar a infraestrutura de chamadas de voz: TTS (Text-to-Speech), ASR (reconhecimento de fala), eventos de chamada em runtime.

**Pré-condições:**
- Serviço PBX em execução
- Configuração de TTS e ASR ativa
- Canal de voz disponível

**Passos do roteiro:**

1. **Smoke de eventos de chamada**
   - Executar `qa-pbx-call-events-runtime-smoke` via adapter PBX
   - Simular evento de chamada entrante
   - Verificar: eventos runtime processados corretamente, sem erros de enfileiramento

2. **TTS e ASR**
   - Executar `qa-pbx-voice-tts-asr-smoke` via adapter PBX
   - O sistema sintetiza fala a partir de texto (TTS)
   - O sistema reconhece fala e transcreve (ASR)
   - Verificar: texto sintetizado audível, transcrição com acurácia aceitável

3. **Testes RPA de voz**
   - Executar os 4 cenários `rpa-test-flow-*` do domínio PBX
   - Cada gravação RPA testa um fluxo específico de tela do módulo PBX
   - Verificar telas e elementos corretos em cada step

**Cenários envolvidos:**
- `qa-pbx-call-events-runtime-smoke` (technical, pbx)
- `qa-pbx-voice-tts-asr-smoke` (technical, pbx)
- `rpa-test-flow-659d7749`, `rpa-test-flow-6f484f7a`, `rpa-test-flow-a41fb4e3`, `rpa-test-flow-a85c4a4d` (regression, rpa)

**O que verificar após execução:**
- Latência de TTS ≤ 2s
- ASR com ≥ 85% de acurácia em amostras de teste
- Sem falhas de timeout em eventos de chamada

---

### JORNADA 6: PBX — Operação PBX

**Objetivo:** Validar operações de gestão da URA (Unidade de Resposta Audível): publicação, rollback e consistência de configuração.

**Pré-condições:**
- URA configurada com menu de voz ativo
- Ambiente com capacidade de rollback

**Passos do roteiro:**

1. **Publicação de URA**
   - Executar `qa-ura-publish-rollback-smoke` via adapter PBX
   - Publicar configuração da URA no ambiente de teste
   - Verificar: publicação concluída sem erro, versão ativa atualizada

2. **Rollback**
   - Simular rollback para versão anterior da URA
   - Verificar: versão anterior restaurada, chamadas roteadas corretamente

3. **Consistência de configuração**
   - Verificar que o menu de voz responde conforme configurado
   - Assertar que rotas de ramal e trunk estão corretas após rollback

**Cenários envolvidos:**
- `qa-ura-publish-rollback-smoke` (smoke, pbx)

**O que verificar após execução:**
- URA em versão correta após publicação
- Rollback não deixa estado inconsistente
- Chamadas de teste roteadas ao ramal correto

---

### JORNADA 7: CORE — Jornada Core

**Objetivo:** Validar as operações fundamentais da plataforma: autenticação, criação de tenants, inteligência de configuração e filas físicas.

**Pré-condições:**
- Serviço de autenticação em execução
- Acesso a conta com permissão de criação de tenant
- Banco de dados acessível

**Passos do roteiro:**

1. **Autenticação (login)**
   - Executar `qa-core-auth-login`
   - Fazer login com credenciais válidas
   - Verificar: token JWT emitido, sessão ativa, claims corretos

2. **Criação de tenant**
   - Executar `qa-core-tenants-create`
   - Criar novo tenant via API/UI
   - Verificar: tenant criado com ID único, configuração padrão aplicada

3. **Inteligência de tenant**
   - Executar `qa-core-config-tenant-intelligence`
   - Verificar que a configuração de inteligência (AI, RAG) está ativa no tenant
   - Assertar que modelos padrão estão associados

4. **Fila física**
   - Executar `qa-physical-queue-smoke`
   - Simular enfileiramento e despacho de item
   - Verificar: item enfileirado, processado e removido corretamente

5. **Exemplo RPA**
   - Executar `rpa-example-test` (gravação `example-test`)
   - Dois steps: navigate + assert de tela
   - Verificar: tela carregada e elemento correto presente

**Cenários envolvidos:**
- `qa-core-auth-login` (smoke, hybrid)
- `qa-core-tenants-create` (regression, hybrid)
- `qa-core-config-tenant-intelligence` (technical, api)
- `qa-physical-queue-smoke` (smoke, api)
- `rpa-example-test` (regression, rpa, gravação: `example-test`)

**O que verificar após execução:**
- Login sem MFA bypass (segurança)
- Tenant criado sem vazamento de dados entre tenants
- Fila sem perda de mensagem

---

### JORNADA 8: UNMAPPED — Não Mapeado

**Objetivo:** Domínio de fallback. Agrupa cenários cujo ID não contém nenhuma keyword reconhecida pelo `journeyRegistry.js`, portanto não puderam ser classificados em nenhum domínio de negócio.

**Como identificar cenários aqui:**
- IDs que não começam com `business-`, `qa-`, `rpa-` e não contêm keywords de domínio
- Cenários adicionados ao `meshRegistry.json` sem campo `domain` explícito e sem keywords no `id`

**Passos do roteiro:**

1. **Identificar o cenário**
   - Verificar o log de fallback (habilitar `QA_WAVES_LOG_UNMAPPED=1`)
   - Analisar o ID e `flow` do cenário para determinar o domínio correto

2. **Reclassificar**
   - Adicionar o campo `domain` explícito ao cenário no `meshRegistry.json`
   - Ou adicionar keyword ao `id` para que o `inferDomainMappingFromScenario()` reclassifique corretamente

3. **Validar reclassificação**
   - Reiniciar a API
   - Verificar que o cenário aparece no domínio correto
   - O domínio UNMAPPED deve estar vazio após reclassificação

**Nota:** Atualmente nenhum cenário aparece nesta jornada em produção (todos os 50 do meshRegistry têm `domain` explícito). O domínio UNMAPPED na UI é uma rede de segurança para cenários futuros sem classificação.

---

### JORNADA 9: CLINIC — Clinic Customer Journey

**Objetivo:** Validar o módulo de clínica médica/saúde: smoke da tela de manutenção.

**Pré-condições:**
- Módulo clinic habilitado no tenant
- Tela de manutenção acessível

**Passos do roteiro:**

1. **Smoke da tela de manutenção**
   - Executar `business-clinic-scr-01` (smoke, hybrid)
   - Navegar até a tela de manutenção do módulo clinic
   - Verificar: tela carrega sem erro 500, elementos principais visíveis

**Cenários envolvidos:**
- `business-clinic-scr-01` — Clinic maintenance screen smoke

**O que verificar após execução:**
- HTTP 200 na navegação
- Sem erros JavaScript no console
- Elementos de UI corretos renderizados

**Nota:** Esta jornada tem status **GO** na UI, indicando que o único cenário disponível passou com sucesso na última execução.

---

### JORNADA 10: FOOD — Food Customer Journey

**Objetivo:** Validar o módulo de pedidos no segmento food (restaurantes, delivery).

**Pré-condições:**
- Módulo food habilitado no tenant
- Cardápio com pelo menos um item configurado

**Passos do roteiro:**

1. **Smoke da tela de pedidos**
   - Executar `business-food-scr-01` (smoke, hybrid)
   - Navegar até a tela Orders do módulo food
   - Verificar: listagem de pedidos carrega, filtros funcionando

**Cenários envolvidos:**
- `business-food-scr-01` — Food Orders screen smoke

**O que verificar após execução:**
- Tela de pedidos acessível sem erro
- Lista de pedidos renderizada (mesmo que vazia)
- Filtros de status (pendente, confirmado, entregue) visíveis

---

### JORNADA 11: MERCADO — Unmapped Journey

**Objetivo:** Validar o módulo de marketplace / mercado.

**Pré-condições:**
- Módulo mercado habilitado no tenant
- Pelo menos um produto/nó configurado

**Passos do roteiro:**

1. **Smoke do marketplace**
   - Executar `business-market-scr-01` (smoke, hybrid)
   - Navegar até a tela de nós/marketplace
   - Verificar: tela carrega corretamente, estrutura de nós visível

**Cenários envolvidos:**
- `business-market-scr-01` — Market node marketplace screen smoke

**O que verificar após execução:**
- Tela de marketplace acessível
- Nodes/produtos listados sem erro
- Sem regressão visual após deploys

**Nota de nomenclatura:** O nome "Unmapped Journey" exibido na UI é gerado automaticamente (`toNameFromId('market_customer_journey')`). Recomenda-se adicionar este domínio ao `JOURNEY_BLUEPRINTS` com nome "Mercado" para corrigi-lo.

---

### JORNADA 12: SERVICES — Services Customer Journey

**Objetivo:** Validar o módulo de soluções/serviços gerais da plataforma.

**Pré-condições:**
- Módulo services habilitado
- Ao menos uma solução configurada

**Passos do roteiro:**

1. **Smoke da tela de soluções**
   - Executar `business-serv-scr-01` (smoke, hybrid)
   - Navegar até a tela Solutions do módulo services
   - Verificar: lista de soluções carrega sem erro

**Cenários envolvidos:**
- `business-serv-scr-01` — Services solutions screen smoke

**O que verificar após execução:**
- HTTP 200 e tela acessível
- Soluções disponíveis listadas corretamente
- Sem erros de permissão ao acessar

---

### JORNADA 13: BPMN — Bpmn Editor Journey

**Objetivo:** Validar o editor de fluxos BPMN integrado à plataforma.

**Pré-condições:**
- Editor BPMN acessível no tenant
- Permissão de criação/edição de fluxos

**Passos do roteiro:**

1. **Smoke do editor**
   - Executar `qa-bpmn-editor-smoke` (technical, api)
   - Abrir o editor BPMN
   - Verificar: editor renderiza, canvas carregado, toolbar visível

2. **Operação básica**
   - Criar um elemento (task ou event) no canvas
   - Salvar o fluxo
   - Verificar que o fluxo persiste após reload

**Cenários envolvidos:**
- `qa-bpmn-editor-smoke` — bpmn_editor_smoke

**O que verificar após execução:**
- Editor sem erro de renderização
- Elementos do canvas interativos
- Persistência do fluxo salvo

---

### JORNADA 14: OMNICHANNEL — Omnichannel Operations

**Objetivo:** Validar as operações omnichannel da plataforma: integração ChatPro, conexões WhatsApp e fluxos RPA de tela no módulo Studiooly.

**Pré-condições:**
- Integração ChatPro configurada
- Conexão WhatsApp ativa ou sandbox disponível
- Módulo Studiooly acessível

**Passos do roteiro:**

1. **Smoke ChatPro Omnichannel**
   - Executar `qa-chatpro-omnichannel-smoke`
   - Verificar integração básica com ChatPro
   - Assertar que canal omnichannel está responsivo

2. **Conexões WhatsApp**
   - Executar `rpa-whatsapp-connections-rpa` (gravação: `whatsapp-connections-rpa`)
   - Steps: navigate → wait → assert → assert → wait
   - Verificar: página de conexões WhatsApp carrega, lista de conexões visível, status das conexões correto

3. **Testes RPA Studiooly (11 gravações)**
   - Executar os 11 cenários `rpa-test-flow-*` do domínio OMNICHANNEL
   - Cada gravação testa um fluxo específico de tela do Studiooly com número diferente de steps (19–28 steps)
   - Os maiores (28 steps: `rpa-test-flow-3571aa07`) cobrem fluxos completos de configuração
   - Os menores (5 steps: `rpa-test-flow-cf71792a`, `rpa-test-flow-da6f66c1`) são smoke rápidos

**Cenários envolvidos:**
- `qa-chatpro-omnichannel-smoke` (smoke, api)
- `rpa-whatsapp-connections-rpa` (regression, rpa)
- 11 × `rpa-test-flow-*` com `flow: "IA - Teste RPA - studiooly"` (regression, rpa)

**O que verificar após execução:**
- Canal ChatPro sem latência excessiva
- Conexão WhatsApp visível e com status ativo
- Todas as 11 gravações RPA sem falha de `assert`

**Atenção — duplicidade de nome:** Os 11 cenários `rpa-test-flow-*` têm o mesmo nome de flow ("IA - Teste RPA - studiooly"). Em caso de falha, identificar qual gravação específica falhou pelo `rpaRecordingId` no replay, não pelo nome do flow.

---

## 5. Resumo das Duplicidades

| # | Tipo | Arquivo | Impacto | Ação |
|---|------|---------|---------|------|
| 1 | Cenário com mesmo `id` (status diferente) | `scenario-store.json` | Renderização dupla na UI | Remover entrada `status: "active"` |
| 2 | 15 cenários com mesmo nome de `flow` | `meshRegistry.json` | UI ambígua, debugging difícil | Diferenciar nomes pelo conteúdo |
| 3 | 2 tenants com mesmo nome de exibição | Banco de dados | Usuário seleciona tenant errado | Renomear um dos tenants |
| 4 | Domínios sem blueprint fixo gerando nomes automáticos | `journeyRegistry.js` | Nomes confusos (ex.: "Unmapped Journey") | Adicionar ao `JOURNEY_BLUEPRINTS` |
| 5 | Campo `journey` ausente em meshRegistry | `meshRegistry.json` | Fragilidade no mapeamento por keywords | Adicionar campo explícito nos cenários |

---

## 6. Cobertura Atual

| Domínio | Cenários | Status Geral | Observação |
|---------|----------|-------------|-----------|
| FITNESS | 8 (+2 no scenario-store) | GO (Cliente Novo) | Melhor coberto |
| BEAUTY | 12 | WARNING | Bem coberto, sem execução real recente |
| PBX | 7 | WARNING | 4 RPA com nome ambíguo |
| CORE | 5 | WARNING | Cobertura básica |
| OMNICHANNEL | 13 | WARNING | 11 RPA com nome ambíguo |
| CLINIC | 1 | GO | Apenas smoke de tela |
| FOOD | 1 | WARNING | Apenas smoke de tela |
| MERCADO | 1 | WARNING | Apenas smoke, nome de jornada incorreto |
| SERVICES | 1 | WARNING | Apenas smoke de tela |
| BPMN | 1 | WARNING | Apenas smoke técnico |
| UNMAPPED | 0 | WARNING | Domínio de fallback vazio |

**Total: 50 cenários em 11 domínios / 14 jornadas**
