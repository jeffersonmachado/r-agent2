# Service Operations Kernel

## O que é

O **Service Operations Kernel** é o núcleo mínimo e universal que sustenta a operação da plataforma.

Ele representa o conjunto de capacidades que todos os domínios do `r-agent2` compartilham, mesmo quando a UI, a vertical e a nomenclatura de negócio são diferentes.

## Relação com outros conceitos

- **Autonomous Operations Platform** descreve a categoria externa do produto
- **Operational Operating System** descreve a arquitetura interna da plataforma
- **Service Operations Kernel** descreve o núcleo mínimo que torna essa arquitetura reutilizável e coerente

## Componentes do kernel

## Implementação canônica atual

Na base atual do projeto, o ponto de entrada arquitetural do kernel passa a ser a fachada:

- `api/core/service-operations-kernel/ServiceOperationsKernel.js`

Ela consolida o ciclo operacional em torno de:

- `operational-events`
- `operational-state`
- `operational-decision`
- `operational-actions`
- `operational-outcomes`
- `operational-memory`

Além disso:

- `api/core/operational-pipeline` permanece como **fachada legada compatível**, mas delegando ao kernel
- `api/core/operational-agent/OperationalCanonicalPipelineService.js` permanece como **fachada do ciclo canônico**, também delegando ao kernel
- `api/core/operational-state` passa a ser a porta de entrada oficial para leitura/projeção de estado, reduzindo acoplamento direto com `operational-state-v2`

Isso formaliza, no código, a distinção entre:

- **kernel**: núcleo operacional reutilizável
- **fachadas legadas**: compatibilidade para rotas, serviços e integrações já existentes
- **domínios verticais**: scheduling, support, CRM, revenue, etc.

### 1. Canonical Entities

Entidades operacionais mínimas usadas para interpretar a operação.

Exemplos:

- `Contact`
- `Conversation`
- `Ticket`
- `Booking`
- `Queue Item`
- `Task`
- `Order`
- `Operational Actor`

### 2. Canonical Events

Tudo relevante que acontece na operação deve ser representável por eventos canônicos.

Exemplos:

- `conversation.received`
- `ticket.created`
- `booking.cancelled`
- `booking.confirmed`
- `queue.wait_exceeded`
- `task.overdue`
- `order.delayed`

### 3. State Projections

O kernel precisa projetar o estado operacional utilizável pela decisão.

Exemplos:

- `ContactState`
- `TicketState`
- `ConversationState`
- `BookingState`
- `QueueState`

### 4. Decision Interface

Forma padrão de perguntar ao sistema:

`qual é a próxima melhor ação operacional para esta entidade neste estado?`

### 5. Action Interface

Forma padrão de executar decisões.

Exemplos:

- automação
- playbook
- quick action
- assistive action
- campaign
- escalation
- assignment

### 6. Outcome Model

Toda ação precisa gerar resultado observável.

Exemplos:

- `resolved`
- `accepted`
- `ignored`
- `rescheduled`
- `converted`
- `reopened`

### 7. Memory and Feedback

O resultado precisa voltar para a memória operacional e influenciar decisões futuras.

## Leitura por domínio

### Scheduling

`Booking -> Event -> BookingState -> Decision -> Campaign/Invite -> Outcome`

### Support

`Ticket -> Event -> TicketState -> Decision -> Quick Action/Playbook -> Outcome`

### CRM / Reactivation

`Contact -> Event -> ContactState -> Decision -> Campaign/Assistive Action -> Outcome`

## O que deve ficar fora do kernel

O kernel deve permanecer pequeno. Portanto, ele não deve concentrar:

- dashboards específicos
- lógica visual de páginas
- regras muito particulares de vertical
- integrações muito específicas
- nomenclaturas comerciais de uma única vertical

Esses elementos ficam nas camadas acima:

- domínios operacionais
- templates verticais
- adapters
- frontend
- integrações

## Papel estratégico

Pensar o `r-agent2` a partir do kernel ajuda a evitar crescimento por módulos independentes.

A pergunta deixa de ser:

`como criar um módulo novo para uma vertical?`

E passa a ser:

`como essa necessidade reutiliza entidades, eventos, estado, decisão e outcome do mesmo kernel?`

## Regra de alinhamento

Sempre que um novo domínio for criado, ele deve ser mapeável para:

`entity -> event -> state -> decision -> action -> outcome -> memory`
