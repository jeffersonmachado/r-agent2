# Sistema de Fallback - Documentação Técnica

## Visão Geral

O sistema de fallback do r-agent2 é um mecanismo centralizado e progressivo que garante que nenhum fluxo falhe silenciosamente. Ele detecta erros, controla tentativas e escala para atendimento humano quando necessário.

## Arquitetura

### Componentes Principais

1. **FallbackController** (`frontend/src/core/FallbackController.js` / `engine/fallbackController.js`)
   - Ponto único de decisão de fallback
   - Stateless por chamada (estado via contexto)
   - Decide ação: retry, options, human, end

2. **FallbackNode** (`frontend/src/editor/nodeSchemas.js`)
   - Nó visual no editor
   - Entradas: in, error, timeout, no_match
   - Saídas: retry, options, human, end

3. **flowValidator** (`frontend/src/editor/flowValidator.js`)
   - Validação estrutural obrigatória
   - Garante que todo fluxo tenha FallbackNode

4. **fallbackNodeHandler** (`engine/nodes/fallbackNode.js`)
   - Handler de execução do FallbackNode
   - Delega decisões ao FallbackController

5. **HumanEscalationAdapter** (`engine/services/humanEscalationAdapter.js`)
   - Interface genérica de escalada humana
   - Desacoplada de canal específico

## Como Funciona no Editor

### Criando um Fluxo com Fallback

1. **Adicione um FallbackNode ao fluxo**
   - O fluxo DEVE conter pelo menos 1 FallbackNode
   - Validação estrutural obrigatória

2. **Configure o FallbackNode**
   - `maxAttempts`: Máximo de tentativas (padrão: 3)
   - `confidenceThreshold`: Threshold de confiança (padrão: 0.75)
   - `enableEmotionCheck`: Detectar frustração (padrão: true)
   - `escalationMode`: Modo de escalada - `"ticket"` (assíncrono) ou `"human"` (síncrono) (padrão: `"ticket"`)
   - `allowReturnToBot`: Permitir retorno ao bot após atendimento (padrão: `true`)
   - `queue`: Nome da fila para escalada via ticket (apenas para modo `"ticket"`, padrão: `"default"`)
   - `safeReturnNode`: Nó para retorno após escalada humana (opcional)

3. **Conecte entradas de erro**
   - Nós com `errorPorts: true` podem conectar saída de erro ao FallbackNode
   - Nós com `supportsTimeout: true` podem conectar timeout ao FallbackNode

4. **Conecte saídas do FallbackNode**
   - `retry`: Nó para tentar novamente
   - `options`: Nó para oferecer opções ao usuário
   - `human`: Nó de escalada humana
   - `end`: Nó de encerramento

### Validação

O botão "Validar" executa:
1. Validação local de fallback (flowValidator)
2. Validação do backend (engine/validator.js)

**Erros comuns:**
- `NO_FALLBACK_NODE`: Fluxo sem FallbackNode
- `ORPHAN_NODE`: Nó desconectado
- `PATH_WITHOUT_TERMINATION`: Caminho sem término adequado

## Como Funciona no Runtime

### Fluxo de Execução

1. **Erro detectado**
   - Durante execução, qualquer erro gera evento:
     - `intent_error`: Intenção não reconhecida
     - `flow_error`: Erro no fluxo
     - `data_error`: Erro de dados
     - `timeout`: Timeout
     - `no_match`: Sem correspondência

2. **Evento encaminhado ao FallbackNode**
   - Input contém: `fallbackType`, `error`, `userMessage`

3. **FallbackController processa**
   - Cria contexto de fallback
   - Detecta loops e frustração
   - Decide ação baseada em tentativas

4. **Ação executada**
   - `retry`: Volta ao nó configurado
   - `options`: Oferece opções ao usuário
   - `human`: Escala para atendimento humano
   - `end`: Encerra conversa

### Limite de Tentativas

- Máximo de 3 tentativas por padrão (configurável)
- Contagem por nó específico
- Após 3 tentativas, escalada automática para humano

### Detecção de Loops

- Detecta quando mesmo nó aciona fallback 2+ vezes nas últimas 3 ocorrências
- Escala imediatamente para humano quando detectado

### Detecção de Frustração

- Palavras-chave: "não entendi", "não funciona", "erro", etc.
- Escala imediatamente para humano quando detectado

## Escalada Humana

O sistema suporta **dois modos de escalada humana**:

### 1. Modo Ticket (Assíncrono) - Padrão

**Características:**
- Escalada assíncrona via sistema de tickets
- Usuário aguarda atendimento em fila
- Atendente responde quando disponível
- Bot suspende processamento durante atendimento
- Contexto completo preservado no ticket

**Quando usar:**
- Atendimento não urgente
- Alta demanda (múltiplos atendentes)
- Necessidade de histórico e rastreamento
- Integração com sistemas de CRM/helpdesk

**Configuração:**
```javascript
{
  escalationMode: 'ticket',
  queue: 'suporte', // Nome da fila
  allowReturnToBot: true,
  safeReturnNode: 'node_retorno'
}
```

**Fluxo:**
1. Fallback detecta necessidade de escalada
2. Cria ticket na fila especificada
3. Bot envia mensagem informativa ao usuário
4. Bot suspende processamento
5. Atendente assume via painel de suporte
6. Ao encerrar ticket, bot pode retomar (se `allowReturnToBot: true`)

**Integração:**
- Usa sistema de tickets existente (`api/services/queueService.js`)
- Rotas `/support` já disponíveis
- Interface de atendimento em `frontend/src/pages/SupportPage.jsx`

### 2. Modo Human (Síncrono) - Opcional

**Características:**
- Escalada síncrona para humano em tempo real
- Humano assume conversa imediatamente
- Bot suspende completamente
- Comunicação em tempo real (requer WebSocket/API)
- Retorno controlado ao bot após atendimento

**Quando usar:**
- Atendimento urgente
- Necessidade de resposta imediata
- Casos complexos que requerem interação em tempo real
- Quando disponibilidade de atendente é garantida

**Configuração:**
```javascript
{
  escalationMode: 'human',
  allowReturnToBot: true,
  safeReturnNode: 'node_retorno'
}
```

**Fluxo:**
1. Fallback detecta necessidade de escalada
2. Cria sessão de atendimento humano síncrono
3. Bot envia mensagem informativa ao usuário
4. Bot suspende completamente
5. Humano assume via interface em tempo real
6. Mensagens são roteadas para humano (WebSocket/API)
7. Ao encerrar, bot retoma no `safeReturnNode` (se `allowReturnToBot: true`)

**Implementação:**
- Adapter básico: `engine/services/humanLiveAdapter.js`
- Interface WebSocket/API deve ser implementada na camada de API
- Por enquanto, é um MVP (placeholder para integração futura)

**Limitações atuais:**
- Interface de WebSocket não implementada
- Requer desenvolvimento de UI de atendimento em tempo real
- Integração com sistema externo necessária

### Comparação dos Modos

| Característica | Ticket (Assíncrono) | Human (Síncrono) |
|----------------|-------------------|------------------|
| **Tempo de resposta** | Variável (fila) | Imediato |
| **Complexidade** | Baixa (já implementado) | Média (requer WebSocket) |
| **Escalabilidade** | Alta (múltiplos atendentes) | Média (limita por disponibilidade) |
| **Rastreamento** | Completo (tickets) | Básico (sessões) |
| **Uso recomendado** | Casos gerais | Casos urgentes |

### Interface do Adapter (Legado)

```javascript
const adapter = new HumanEscalationAdapter();

// Escalar para humano (modo genérico - legado)
await adapter.escalateToHuman({
  sessionId: 'session-123',
  flowId: 'flow-456',
  reason: 'intent',
  attempt: 3,
  history: [...],
  variables: {...},
  safeReturnNode: 'node-789',
});

// Verificar se pode retornar
const canReturn = await adapter.canReturnToBot('session-123');

// Retornar ao bot
await adapter.returnToBot('session-123', 'node-789');
```

**Nota:** O adapter genérico (`HumanEscalationAdapter`) é mantido para compatibilidade. O sistema agora usa modos explícitos (`ticket` ou `human`) configurados no FallbackNode.

## Observabilidade

### Logs Estruturados

Eventos de fallback são logados via `logger.event()`:

```javascript
logger.event('fallback_triggered', {
  fallbackType: 'intent',
  attempt: 1,
  nodeId: 'node-123',
  sessionId: 'session-456',
  action: 'retry',
  timestamp: '2025-12-30T12:00:00.000Z',
  hasLoop: false,
  hasFrustration: false,
});
```

### Eventos Disponíveis

- `fallback_triggered`: Fallback acionado
- `fallback_loop_detected`: Loop detectado
- `fallback_frustration_detected`: Frustração detectada
- `fallback_max_attempts_reached`: Máximo de tentativas atingido

### Visualização

O componente `FallbackEventsViewer` exibe eventos recentes de fallback no editor.

## Boas Práticas

### Criando Fluxos Seguros

1. **Sempre inclua FallbackNode**
   - Todo fluxo DEVE ter pelo menos 1 FallbackNode
   - Conecte todos os caminhos de erro ao FallbackNode

2. **Configure tentativas adequadamente**
   - 3 tentativas é um bom padrão
   - Ajuste baseado na complexidade do fluxo

3. **Use nó de retorno seguro**
   - Configure `safeReturnNode` para permitir retorno após escalada humana

4. **Teste cenários de erro**
   - Simule erros de intenção
   - Simule timeouts
   - Simule erros de dados

5. **Monitore eventos de fallback**
   - Use `FallbackEventsViewer` para monitorar
   - Analise padrões de erro

### Evitando Loops

- Não conecte FallbackNode diretamente a si mesmo
- Use nós intermediários para retry
- Configure `safeReturnNode` adequadamente

### Escalada Humana

- **Escolha o modo adequado:**
  - Use `ticket` para atendimento assíncrono (padrão, recomendado)
  - Use `human` apenas se necessário atendimento síncrono (requer implementação de WebSocket)
  
- **Configure adequadamente:**
  - `escalationMode`: Escolha entre `"ticket"` ou `"human"`
  - `queue`: Defina fila para modo ticket
  - `allowReturnToBot`: Configure se permite retorno ao bot
  - `safeReturnNode`: Configure nó de retorno seguro
  
- **Mantenha contexto completo:**
  - Contexto é preservado automaticamente em ambos os modos
  - Histórico completo disponível para atendente
  
- **Permita retorno controlado:**
  - Configure `allowReturnToBot: true` para permitir retorno
  - Defina `safeReturnNode` para nó de retorno seguro

## Regras Obrigatórias

1. ✅ **Nenhum fluxo é válido sem FallbackNode**
2. ✅ **Todo erro passa pelo FallbackController**
3. ✅ **Máximo de 3 tentativas (configurável)**
4. ✅ **Nenhum erro técnico visível ao usuário final**
5. ✅ **Escalada humana preserva contexto**
6. ✅ **Atendimento humano permite retorno ao bot**

## Troubleshooting

### Fallback não está sendo acionado

- Verifique se o fluxo tem FallbackNode
- Verifique se as conexões de erro estão corretas
- Verifique logs para eventos de erro

### Loop infinito

- Verifique se FallbackNode não está conectado a si mesmo
- Verifique histórico de fallbacks no estado
- Use `safeReturnNode` para quebrar loops

### Escalada humana não funciona

**Modo Ticket:**
- Verifique se fila existe (`queue` configurado corretamente)
- Verifique se sistema de tickets está funcionando
- Verifique rotas `/support` disponíveis
- Verifique logs para criação de tickets

**Modo Human:**
- Verifique se `escalationMode: 'human'` está configurado
- Verifique se adapter de atendimento síncrono está implementado
- Verifique se WebSocket/API de atendimento está disponível
- Verifique se `safeReturnNode` está configurado
- Verifique logs para criação de sessões humanas

## Referências

- `PROJECT_RULES.md`: Regras gerais do projeto
- `frontend/src/core/FallbackController.js`: Controller do frontend
- `engine/fallbackController.js`: Controller da engine (com modos de escalada)
- `engine/nodes/fallbackNode.js`: Handler do FallbackNode (com configuração de modo)
- `engine/services/humanEscalationAdapter.js`: Adapter genérico de escalada humana (legado)
- `engine/services/humanLiveAdapter.js`: Adapter de atendimento humano síncrono (MVP)
- `api/services/queueService.js`: Sistema de tickets (modo ticket)
- `api/services/messageProcessor.js`: Processador de mensagens (integração com modos)

