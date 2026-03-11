# Operational Core Domains

## Núcleo operacional

Os domínios centrais da plataforma são:

- CRM
- Support
- Conversations
- Scheduling
- Queues
- Orders
- Tasks
- Voice

## Papel do core operacional

Esses domínios concentram a operação diária do negócio e geram os fatos que alimentam o loop autônomo da plataforma.

## Leitura por domínio

### CRM

Relacionamento, perfil operacional, contexto do contato e oportunidades.

### Support

Tickets, atendimento, handover, suporte contextual e workspaces operacionais.

### Conversations

Mensagens, histórico, canais, contexto e execução de fluxo conversacional.

### Scheduling

Agenda, gaps, reativação, waiting list, campanhas e otimização operacional.

### Queues

Filas digitais e físicas, roteamento, priorização e SLA.

### Orders

Pedidos, status, suporte e eventos de operação de serviço.

### Tasks

Ações operacionais estruturadas, follow-ups e pendências.

### Voice

URA, runtime de voz, atendimento telefônico e automação de voice flows.

## Regra de arquitetura

Sempre que possível, operações nesses domínios devem:

`gerar evento -> atualizar estado -> permitir decisão -> executar -> registrar outcome`
