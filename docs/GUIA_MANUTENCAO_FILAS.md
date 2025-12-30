# 📋 Guia Prático de Manutenção de Filas

Este guia mostra como realizar manutenção no sistema de filas usando a interface web e ferramentas de linha de comando.

## 🔄 Integração com Sistema de Fallback

O sistema de filas está integrado com o sistema de fallback humano. Existem **dois modos de escalada**:

### Modo Ticket (Assíncrono) - Usa Filas

- **Escalada via filas**: Quando um FallbackNode está configurado com `escalationMode: "ticket"`, ele cria tickets na fila especificada
- **Fila configurável**: Cada FallbackNode pode especificar uma fila via propriedade `queue`
- **Fila padrão**: Se não especificada, usa a fila `"default"`
- **Atendimento assíncrono**: Usuário aguarda em fila, atendente responde quando disponível

### Modo Human (Síncrono) - Não Usa Filas

- **Escalada direta**: Quando um FallbackNode está configurado com `escalationMode: "human"`, não cria tickets
- **Atendimento em tempo real**: Humano assume conversa imediatamente via WebSocket/API
- **Sem filas**: Este modo não utiliza o sistema de filas

### Boas Práticas

1. **Crie filas específicas por tipo de atendimento**:
   - `suporte_n1`: Suporte técnico nível 1
   - `vendas`: Atendimento comercial
   - `financeiro`: Questões financeiras
   - `urgente`: Atendimento prioritário

2. **Configure FallbackNodes adequadamente**:
   - Use `escalationMode: "ticket"` para atendimento assíncrono (recomendado)
   - Especifique `queue` apropriada para cada contexto
   - Use `escalationMode: "human"` apenas quando necessário atendimento síncrono

3. **Monitore distribuição de tickets**:
   - Verifique quais filas recebem mais tickets
   - Ajuste recursos de atendimento conforme necessário
   - Use métricas para otimizar distribuição

## 🖥️ Interface Web - Página de Manutenção

### Acessar a Página

1. Abra o navegador e acesse: `http://localhost:3000/maintenance`
2. Você verá a página de **Manutenção de Tickets** com:
   - 📊 Estatísticas do sistema
   - 📋 Lista de tickets com filtros
   - 🔧 Controles de atualização

### Operações na Interface

#### 1. Visualizar Estatísticas

A página mostra automaticamente:
- **Total de Tickets**: Quantidade total no sistema
- **Por Status**: Aguardando, Em Atendimento, Fechados
- **Tickets Antigos**: Fechados há mais de 7 dias e 30 dias
- **Por Fila**: Distribuição de tickets por fila
- **Uso de Memória**: RSS, Heap Total, Heap Usado, External

#### 2. Filtrar Tickets

Use os filtros na parte superior:
- **Status**: Filtrar por `Aguardando`, `Em Atendimento` ou `Fechados`
- **Fila**: Selecionar uma fila específica
- **Buscar**: Buscar por ID, telefone ou mensagem

#### 3. Navegar entre Páginas

- Use os controles de paginação no final da lista
- Ajuste a quantidade de itens por página (50, 100, 200, 500)
- Navegue entre páginas usando os botões: Primeira, Anterior, Próxima, Última

#### 4. Atualizar Dados

- **Auto-atualizar**: Marque o checkbox para atualizar automaticamente a cada 10 segundos
- **Atualizar Manual**: Clique no botão "🔄 Atualizar"

### ⚠️ Monitoramento de Recursos

A página mostra métricas importantes:
- **Fechados > 7 dias**: Tickets que podem ser limpos
- **Fechados > 30 dias**: Tickets muito antigos
- **Uso de Memória**: Monitore o consumo de memória do servidor

---

## 🔧 Interface Web - Página de Atendimento

### Acessar a Página

1. Acesse: `http://localhost:3000/support`
2. Você verá a página de **Atendimento - Sistema de Filas**

### Operações na Página de Atendimento

#### 1. Selecionar Fila

- Clique em uma fila no painel esquerdo
- A lista de tickets será atualizada automaticamente

#### 2. Gerenciar Tickets

- **Atribuir Ticket**: Selecione um ticket e atribua para um atendente
- **Enviar Mensagem**: Envie mensagens para o usuário via WhatsApp
- **Fechar Ticket**: Feche tickets concluídos

#### 3. Auto-atualização

- A página atualiza automaticamente a cada 5 segundos (ativado por padrão)
- Desmarque o checkbox para desativar

---

## 🛠️ Manutenção via API (Linha de Comando)

### 1. Listar Filas Disponíveis

```bash
curl http://localhost:3000/queues
```

**Resposta:**
```json
["suporte", "vendas", "financeiro"]
```

### 2. Ver Métricas do Sistema

```bash
curl http://localhost:3000/metrics/queues | jq
```

**Resposta:**
```json
{
  "totalTickets": 150,
  "ticketsByStatus": {
    "waiting": 5,
    "in_progress": 10,
    "closed": 135
  },
  "ticketsByQueue": {
    "suporte": 80,
    "vendas": 50,
    "financeiro": 20
  },
  "oldClosedTickets": {
    "olderThan7Days": 45,
    "olderThan30Days": 12
  },
  "memoryUsage": {
    "rss": 52428800,
    "heapTotal": 20971520,
    "heapUsed": 15728640,
    "external": 1048576
  }
}
```

### 3. Listar Tickets

#### Todos os Tickets
```bash
curl http://localhost:3000/tickets | jq
```

#### Filtrar por Status
```bash
# Tickets aguardando
curl http://localhost:3000/tickets?status=waiting | jq

# Tickets em atendimento
curl http://localhost:3000/tickets?status=in_progress | jq

# Tickets fechados
curl http://localhost:3000/tickets?status=closed | jq
```

#### Filtrar por Fila
```bash
curl http://localhost:3000/tickets?queue=suporte | jq
```

#### Com Paginação
```bash
# Primeira página (100 tickets)
curl "http://localhost:3000/tickets?limit=100&offset=0" | jq

# Segunda página
curl "http://localhost:3000/tickets?limit=100&offset=100" | jq
```

### 4. Listar Tickets de uma Fila Específica

```bash
# Todos os tickets da fila "suporte"
curl http://localhost:3000/queues/suporte/tickets | jq

# Apenas tickets aguardando
curl "http://localhost:3000/queues/suporte/tickets?status=waiting" | jq
```

### 5. Obter Ticket Específico

```bash
curl http://localhost:3000/tickets/suporte-1234567890-abc123 | jq
```

### 6. Contar Tickets

```bash
# Total de tickets
curl http://localhost:3000/tickets | jq '.total'

# Tickets aguardando
curl "http://localhost:3000/tickets?status=waiting" | jq '.total'

# Tickets por fila
curl http://localhost:3000/metrics/queues | jq '.ticketsByQueue'
```

---

## 🧹 Limpeza de Tickets Antigos

### Limpeza Automática (Já Configurada)

O sistema já possui limpeza automática configurada que:
- ✅ Remove tickets fechados com mais de 7 dias
- ✅ Executa a cada 1 hora
- ✅ É configurada automaticamente ao iniciar o servidor

**Configuração via Variáveis de Ambiente:**

```bash
# Alterar intervalo de limpeza (padrão: 1 hora)
export TICKET_CLEANUP_INTERVAL_HOURS=2

# Alterar idade máxima dos tickets (padrão: 7 dias)
export TICKET_MAX_AGE_DAYS=14

# Iniciar servidor
node api/server.js
```

### Script de Análise de Tickets

Use o script para analisar tickets antes de limpar:

```bash
# Análise completa (modo dry-run)
node scripts/cleanup-tickets.js --dry-run

# Análise com idade máxima personalizada
MAX_AGE_DAYS=30 node scripts/cleanup-tickets.js --dry-run

# Com API em outro servidor
API_URL=http://outro-servidor:3000 node scripts/cleanup-tickets.js --dry-run
```

**Saída do Script:**
```
🔍 Analisando tickets do sistema...

API URL: http://localhost:3000
Idade máxima para tickets fechados: 7 dias
Modo: DRY RUN (simulação)

📊 Estatísticas:
   Total de tickets: 150
   - Aguardando: 5
   - Em atendimento: 10
   - Fechados: 135
   - Fechados antigos (>7 dias): 45

📋 Tickets por fila:
   suporte: 80
   vendas: 50
   financeiro: 20

🗑️  Tickets fechados antigos (45):
   - suporte-1234567890-abc123 (suporte): 12 dias
   - vendas-1234567891-def456 (vendas): 15 dias
   ...
```

---

## 📊 Operações Comuns de Manutenção

### 1. Monitorar Estado das Filas

```bash
# Ver todas as filas
curl http://localhost:3000/queues

# Ver métricas completas
curl http://localhost:3000/metrics/queues | jq

# Ver tickets aguardando em cada fila
for queue in $(curl -s http://localhost:3000/queues | jq -r '.[]'); do
  echo "=== Fila: $queue ==="
  curl -s "http://localhost:3000/queues/$queue/tickets?status=waiting" | jq 'length'
done
```

### 2. Verificar Tickets Antigos

```bash
# Ver tickets fechados há mais de 7 dias
curl http://localhost:3000/metrics/queues | jq '.oldClosedTickets.olderThan7Days'

# Ver tickets fechados há mais de 30 dias
curl http://localhost:3000/metrics/queues | jq '.oldClosedTickets.olderThan30Days'
```

### 3. Verificar Uso de Memória

```bash
curl http://localhost:3000/metrics/queues | jq '.memoryUsage'
```

### 4. Exportar Dados para Análise

```bash
# Exportar todos os tickets para arquivo JSON
curl http://localhost:3000/tickets?limit=10000 > tickets_backup.json

# Exportar apenas tickets fechados
curl "http://localhost:3000/tickets?status=closed&limit=10000" > tickets_fechados.json

# Exportar métricas
curl http://localhost:3000/metrics/queues > metrics.json
```

---

## 🔍 Troubleshooting

### Problema: Muitos Tickets Acumulados

**Sintomas:**
- Servidor lento
- Alto uso de memória
- Timeouts nas requisições

**Solução:**
1. Verifique quantos tickets fechados existem:
   ```bash
   curl http://localhost:3000/metrics/queues | jq '.ticketsByStatus.closed'
   ```

2. Verifique tickets antigos:
   ```bash
   curl http://localhost:3000/metrics/queues | jq '.oldClosedTickets'
   ```

3. A limpeza automática deve remover tickets fechados com mais de 7 dias. Se necessário:
   - Reduza `TICKET_MAX_AGE_DAYS` para limpar mais rápido
   - Reduza `TICKET_CLEANUP_INTERVAL_HOURS` para executar mais frequentemente

### Problema: Tickets Não Aparecem na Fila

**Causas possíveis:**
1. Ticket foi fechado
2. Fila não existe
3. Status do ticket não corresponde ao filtro

**Solução:**
```bash
# Verificar se o ticket existe
curl http://localhost:3000/tickets/TICKET_ID

# Verificar todos os tickets da fila (sem filtro)
curl http://localhost:3000/queues/FILA/tickets
```

### Problema: Dados Perdidos Após Reiniciar

**Causa:** Armazenamento em memória

**Solução:**
- ⚠️ Dados são perdidos ao reiniciar o servidor
- Para produção, considere migrar para banco de dados (PostgreSQL, MongoDB)
- Faça backups periódicos dos tickets:
  ```bash
  curl http://localhost:3000/tickets?limit=10000 > backup_$(date +%Y%m%d_%H%M%S).json
  ```

---

## 📝 Checklist de Manutenção Diária

- [ ] Verificar métricas do sistema (`/metrics/queues`)
- [ ] Monitorar tickets aguardando em cada fila
- [ ] Verificar tickets antigos (>7 dias)
- [ ] Monitorar uso de memória
- [ ] Verificar se limpeza automática está funcionando

## 📝 Checklist de Manutenção Semanal

- [ ] Analisar tickets fechados antigos
- [ ] Verificar distribuição de tickets por fila
- [ ] Revisar performance do sistema
- [ ] Fazer backup dos dados importantes
- [ ] Verificar logs de limpeza automática

---

## 🚀 Dicas de Performance

1. **Use Paginação**: Sempre use `limit` e `offset` ao listar muitos tickets
2. **Filtre no Servidor**: Use filtros de status e fila na API em vez de filtrar no cliente
3. **Desative Auto-refresh**: Se não precisar de atualização em tempo real, desative o auto-refresh
4. **Monitore Memória**: Acompanhe o uso de memória regularmente
5. **Limpeza Regular**: Mantenha a limpeza automática ativa e ajuste os parâmetros conforme necessário

---

## 📚 Referências

- Documentação completa: `docs/manutencao-filas.md`
- Código do serviço: `api/services/queueService.js`
- Script de limpeza: `scripts/cleanup-tickets.js`

