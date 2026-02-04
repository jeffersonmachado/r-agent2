# Posicionamento do produto (SaaS enterprise)

## 1) O que é

Uma **plataforma unificada de processos e comunicação** orientada a **fluxos visuais (DAG)**, que integra:

- **Automação** (inspirado em **n8n**)
- **Marketing automation** (inspirado em **RD Station**)
- **Atendimento omnichannel** (inspirado em **BLIP / Huggy / Zenvia**)
- **Voz / Contact Center** (inspirado em **Twilio Flex / Talkdesk / Five9**)
- **Orquestração de IA** (inspirado em **LangFlow / Flowise**)
- **Filas físicas / fast service** (inspirado em **Qminder / QLess / Waitwhile / Skiplino**)
- **Delivery / marketplace de pedidos** (inspirado em **iFood / Uber Eats / Rappi / DoorDash**)

O diferencial central é que **tudo vira nodes dentro do DAG**, com execução rastreável, replay, auditoria e métricas.

Em especial, **filas físicas** e **delivery** deixam de ser sistemas “separados” (totem/painel isolados; pedido/logística isolados) e passam a ser parte do mesmo **Event Model** — permitindo mensurar e automatizar a jornada completa “presencial + digital + logística”.

## 2) O que não é

- Não é “só um n8n”: o runtime é o núcleo, mas o produto entrega **suites** (marketing, atendimento, voz, filas físicas) com operação e métricas.
- Não é “só um RD Station”: além de campanhas, há **atendimento e operação** (digital e física) e automação técnica.
- Não é “só um BLIP/Huggy”: além de inbox, há **marketing/ROI**, voz e filas físicas integradas.
- Não é “só um contact center”: voz é um pilar, mas o DAG orquestra toda a jornada (pré e pós-chamada).
- Não é “só um LangFlow/Flowise”: IA é nativa, porém **governada** e aplicada a fluxos e operação, não apenas a protótipos.
- Não é “só um iFood”: delivery é um pilar, mas o diferencial é a **orquestração ponta a ponta** com atendimento/voz/marketing/IA e operação física — tudo rastreável e auditável.

## 3) Tese de mercado (por que unificar)

Empresas operam com pilhas desconectadas. A unificação reduz:

- custo de integração e manutenção,
- inconsistências de dados e de identidade do cliente,
- tempo de resposta e falhas de operação,
- dificuldade de atribuir ROI e custo total.

E aumenta:
- rastreabilidade (execução por nó + replay),
- eficiência operacional (SLA e roteamento),
- velocidade de experimentação (templates e marketplace),
- previsibilidade (limites por tenant, observabilidade e custos).

## 4) ICPs e “wedge” (entrada) por segmento

### ICP A — Operações com fila física (fastfood, clínicas, balcões)
- **Wedge**: **totem + senha + painel + estações + métricas** (Qminder/Waitwhile-like) integrados a WhatsApp/CRM e ao DAG.
- **Por que é um wedge forte**: valor imediato e tangível (redução de caos, visibilidade de espera/abandono, padronização de operação) com implantação local por unidade.
- **Expansão**: atendimento omnichannel + jornadas pós-atendimento + voz/URA + segmentação/ROI.

### ICP B — Atendimento omnichannel com SLA (SMB/mid-market)
- **Wedge**: inbox + filas + handover + analytics (BLIP-like).
- **Expansão**: automação (DAG), IA (copilot) e voz; e, quando houver operação presencial, **fila física** conectada ao mesmo histórico do cliente.

### ICP C — Marketing/RevOps orientado a performance
- **Wedge**: forms/LP/tracker/scoring/jornadas (RD-like).
- **Expansão**: atendimento e voz para fechar ciclo e reduzir CAC; e, em negócios com presença física, conectar **comparecimento/fila/atendimento presencial** para melhorar atribuição.

### ICP D — Operação de pedidos e delivery (restaurantes, dark kitchens, conveniência)
- **Wedge**: **pedido + status em tempo real + notificações + suporte** (iFood/Uber Eats-like) integrados ao omnichannel e ao DAG.
- **Por que é um wedge forte**: reduz incidentes (atrasos, item faltante), melhora SLA e padroniza a operação (produção → expedição → entrega).
- **Expansão**: CRM + marketing (recompra), voz (call back), IA (previsão de atraso e sugestão de compensação) e integração com fila física (loja).

## 5) Como competir (matriz por categoria)

### Versus automação pura (n8n-like)
- **Ganha**: operação (atendimento/voz/fila física), dados do cliente, templates por segmento, dashboards.
- **Perde** (no início): breadth de conectores e comunidade; mitigar com marketplace governado.

### Versus marketing puro (RD-like)
- **Ganha**: unificação com atendimento/voz/físico e execução rastreável.
- **Perde** (no início): profundidade de email/entregabilidade e ecossistema; mitigar por fases.

### Versus atendimento puro (BLIP/Huggy-like)
- **Ganha**: ROI/funil, automação e fila física integrada.
- **Perde** (no início): acabamento e maturidade de features específicas; mitigar com foco em workflows verticais.

### Versus CCaaS (Twilio Flex/Talkdesk/Five9)
- **Ganha**: convergência com marketing/omnichannel/físico e automação de processos.
- **Perde** (no início): completude de voice; mitigar com milestones claros e provider strategy (ex.: r-IPABX).

### Versus IA-orchestration (LangFlow/Flowise)
- **Ganha**: produto operacional com governança, dados, custo e métricas.
- **Perde** (no início): simplicidade “builder-only”; mitigar com UX de nodes e templates.

### Versus delivery/marketplace (iFood/Uber Eats/Rappi/DoorDash)
- **Ganha**: convergência com atendimento/voz/marketing/fila física e automação de processos (SLA + replay + auditoria).
- **Perde** (no início): rede/marketplace e escala logística; mitigar com “delivery próprio + integrações” e foco em operação/suporte/retensão.

## 6) Proposta de valor (mensagem)

**“Da porta da loja ao pós-venda: um único fluxo visual para organizar fila física, gerir pedidos e delivery, atender, ligar, medir e automatizar — com IA e governança.”**

## 7) Estratégia de receita (progressiva)

- **Módulos/suites**: Automação, Marketing, Inbox/Atendimento, Voz, Filas físicas, **Delivery**, IA.
- **Uso**: execuções, eventos (tracker/fila física), **pedidos/eventos de delivery**, seats, minutos de voz, IA, storage (gravações/execuções).
- **Marketplace**: rev-share de nodes/templates/solutions e canal de parceiros.

