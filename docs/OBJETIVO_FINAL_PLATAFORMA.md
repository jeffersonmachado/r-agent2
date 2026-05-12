# Objetivo final (North Star): Plataforma unificada de Receita + Operações

## 1) Visão (o que este produto se torna)

Construir uma plataforma SaaS multi-tenant **enterprise** que unifica, em um único runtime e um único modelo de dados do cliente, as capacidades que hoje estão fragmentadas em múltiplas categorias de ferramentas:

- **Automação visual e runtime DAG** (inspirado em **n8n**): orquestração confiável de processos via flows, nodes plugáveis, execuções rastreáveis e reexecutáveis.
- **Marketing automation** (inspirado em **RD Station**): aquisição, tracking, scoring, jornadas, email, funil, analytics e ROI.
- **Atendimento omnichannel** (inspirado em **BLIP / Huggy / Zenvia**): bot + humano, SLAs, filas, roteamento inteligente e histórico completo.
- **Voz / contact center** (inspirado em **Twilio Flex / Talkdesk / Five9**): URA visual, filas de voz, transferências, gravação, discagem e eventos de chamada como triggers/ações nos flows.
- **IA nativa e componível** (inspirado em **LangFlow / Flowise**): nodes de IA reutilizáveis com contexto unificado, governança e observabilidade de IA.
- **Filas físicas / fast service** (inspirado em **Qminder / QLess / Waitwhile / Skiplino**): totem/kiosk, emissão de senha, painel de chamada, estações, priorização e métricas de espera/throughput integradas ao fluxo.
- **Delivery / marketplace de pedidos** (inspirado em **iFood / Uber Eats / Rappi / DoorDash**): criação de pedido, status em tempo real, preparo/expedição, despacho e tracking de entregador, notificações, avaliação e SLA de entrega integrados ao fluxo.

**North Star**: a plataforma vira o “sistema operacional” onde **toda interação** (lead, mensagem, chamada, evento de site, tarefa, ticket, **senha física**, **pedido**, etapa do funil, execução de node) é um **evento orquestrável**, observável e governado — conectando receita (marketing/vendas) e operações (suporte/contact center, operação física e logística) sem silos.

## 2) Tese de mercado (por que unificar)

As empresas compram pilhas desconectadas: automação + marketing + atendimento + voz + IA. Isso gera:

- **Contexto fragmentado**: cada sistema “vê” o cliente por um ângulo, com identidades não reconciliadas.
- **Operação cara**: integrações frágeis, dados inconsistentes, pouca rastreabilidade ponta a ponta.
- **ROI obscuro**: difícil atribuir receita e custo (tempo humano, minutos de voz, campanhas, automações).

Ao unificar os pilares acima, o produto entrega:

- **Customer 360** orientado a eventos (um histórico completo e auditável).
- **Orquestração real-time + assíncrona** (fila + scheduler) com replay e governança.
- **Medição de ROI e eficiência operacional** no mesmo painel executivo.

## 3) Quem comprará primeiro (ICP) e como expandir

### ICP 1 — SMB/Mid-market com alta intensidade de atendimento omnichannel
- Dor: filas, SLA, produtividade, qualidade e histórico; necessidade de automação e bot para escala.
- Expansão: adicionar voz/contact center e IA para priorização/sugestão.

### ICP 2 — Times de marketing e RevOps orientados a performance
- Dor: tracking, jornada omnichannel, scoring, atribuição e ROI; necessidade de automações confiáveis.
- Expansão: adicionar inbox/atendimento para converter leads e fechar ciclo.

### ICP 3 — Suporte B2B / operações com compliance
- Dor: auditoria, rastreabilidade, RBAC, políticas, dados sensíveis, integrações críticas.
- Expansão: enterprise governance, HA/DR, data residency/BYOK quando necessário.

## 4) Diferenciais defendíveis (moat)

- **Event model único + runtime DAG** (inspirado em n8n): o fluxo é o “contrato de operação”; execução por nó vira trilha auditável (debug/replay).
- **Voz como evento de primeira classe** (inspirado em Twilio Flex/Talkdesk/Five9): chamadas geram triggers e ações dentro do DAG, permitindo automações profundas.
- **Omnichannel e CRM light acoplados ao histórico** (inspirado em BLIP/Huggy/Zenvia): tudo vira contexto operacional e de receita.
- **Operação física como evento de primeira classe** (inspirado em Qminder/Waitwhile/QLess/Skiplino): senhas, chamadas de painel, estações e métricas entram no mesmo modelo de eventos, permitindo automações e mensuração ponta a ponta.
- **Delivery como evento de primeira classe** (inspirado em iFood/Uber Eats/Rappi/DoorDash): pedidos, eventos de preparo, despacho, tracking e incidentes entram no mesmo modelo de eventos, permitindo automações e mensuração “order-to-delivery”.
- **IA nativa componível** (inspirado em LangFlow/Flowise): nodes reutilizáveis com contexto unificado e guardrails (observabilidade de IA, custos, privacidade).
- **Marketplace e templates por segmento** (inspirado em n8n + ecossistemas RD/CCaaS): extensibilidade com governança e monetização via parceiros.

## 5) Princípios de produto (enterprise SaaS)

- **Confiabilidade > features** no core de execução: filas, scheduler, idempotência, replay e observabilidade antes de expansão agressiva de conectores.
- **Governança por padrão**: RBAC, auditoria, credenciais/vault, políticas e limites por tenant.
- **Custos previsíveis**: modelos de preço alinhados a drivers reais (execuções, eventos de tracking, seats, minutos de voz, chamadas de IA).
- **Compliance e privacidade (LGPD)**: consentimento, retenção configurável, trilhas, masking/PII e controles por tenant.
- **Extensível sem quebrar**: SDK/contratos versionados para nodes, templates e integrações.

## 6) Modelo de receita progressiva (como monetizar sem travar adoção)

### Empacotamento por módulos (land and expand)
- **Automação (Core)**: flows + execuções + scheduler + conectores essenciais.
- **Marketing**: forms/landing pages/tracker, jornadas, email, scoring e ROI.
- **Inbox/Atendimento**: omnichannel, filas, SLA, roteamento e supervisão.
- **Voz (CCaaS)**: URA, filas de voz, gravação, transferências, discagem (quando aplicável).
- **Filas físicas (Fast service)**: totem/senha/painel/estações + métricas e integrações com CRM/atendimento/marketing.
- **Delivery (Pedidos/Logística)**: criação e gestão de pedidos, preparo/expedição, despacho/tracking, notificações e pós-venda integrados a CRM/marketing/atendimento.
- **IA**: nodes e copilots por persona (agente, supervisor, marketer), com guardrails.

### Cobrança por uso (alinhada a custo e valor)
- **Execuções** (por flow e por nó), **eventos do tracker**, **eventos/atendimentos físicos** (senhas/chamadas), **pedidos e eventos de delivery** (preparo/despacho/tracking), **seats**, **minutos de voz**, **armazenamento de gravações**, **chamadas de IA**.

### Marketplace
- Revenue share em nodes, templates e “solutions” (pacotes por segmento), com cobrança integrada.

## 7) Base já existente (o que considerar “fundação pronta” no repositório)

O repositório já documenta entregas relevantes que sustentam a ambição enterprise, especialmente:

- **SaaS multi-tenant, RBAC, planos/limites, auditoria, super-admin e onboarding** (ver `history/IMPLEMENTACAO_SAAS_COMPLETA.md`).
- **Padrões de realtime + fallback e métricas** (ver `IMPLEMENTACAO_OTIMIZACOES_WEBSOCKET.md`).
- **Pipeline de IA/RAG e contratos de resposta** (ver `README.md`), útil como ponto de partida para “contexto unificado”.

Esses blocos reduzem risco e antecipam requisitos enterprise (governança, auditoria, limites e observabilidade).

## 8) Definição objetiva de sucesso (métricas North Star)

- **Receita e retenção**: expansão de ARPA/ACV por módulos; churn reduzido via centralização operacional.
- **Eficiência operacional**: SLA atingido, redução de TMA/tempo humano, aumento de automação por jornada/flow.
- **ROI de marketing e funil**: atribuição consistente, custo por aquisição e conversão por canal/jornada.
- **Confiabilidade**: SLOs por runtime (scheduler/fila/executor), MTTR baixo, replay e auditoria completos.

