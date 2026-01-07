# 👤 Guia de Acesso à Interface de Atendimento

Este guia explica como os atendentes acessam e usam a interface de atendimento do r-agent2.

## 🌐 Acesso à Interface

### URL de Acesso

A interface de atendimento está disponível em:

```
http://localhost:3000/support
```

**Em produção:**
```
https://seu-dominio.com/support
```

### Requisitos

- Navegador web moderno (Chrome, Firefox, Edge, Safari)
- Conexão com a internet
- Acesso ao servidor da API (porta 3000 por padrão)

### Autenticação

⚠️ **Status Atual:** Nenhuma autenticação implementada.

**Acesso:** Qualquer pessoa com acesso à URL pode usar a interface.

**Recomendação para Produção:**
- Implementar autenticação (login/senha, OAuth, etc.)
- Restringir acesso por IP ou VPN
- Implementar controle de permissões por usuário

---

## 📱 Interface de Atendimento

### Layout

A interface é dividida em três painéis principais:

1. **Painel Esquerdo - Filas**
   - Lista todas as filas disponíveis
   - Mostra quantidade de tickets aguardando
   - Clique em uma fila para ver seus tickets

2. **Painel Central - Lista de Tickets**
   - Mostra tickets da fila selecionada
   - Filtra apenas tickets aguardando (`waiting`)
   - Exibe informações: ID, telefone, última mensagem

3. **Painel Direito - Detalhes do Ticket**
   - Informações completas do ticket selecionado
   - Campo para atribuir atendente
   - Campo para enviar mensagens
   - Botão para fechar ticket

### Funcionalidades

#### 1. Selecionar Fila

1. No painel esquerdo, clique em uma fila
2. A lista de tickets será atualizada automaticamente
3. Apenas tickets com status `waiting` são exibidos

#### 2. Atribuir Ticket

1. Selecione um ticket na lista
2. No painel direito, digite seu nome/ID no campo "Atribuir para"
3. Clique em "Atribuir"
4. O ticket muda para status `in_progress`

#### 3. Enviar Mensagem

1. Com um ticket selecionado e atribuído
2. Digite a mensagem no campo de texto
3. Clique em "Enviar Mensagem"
4. A mensagem é enviada via WhatsApp para o usuário

#### 4. Fechar Ticket

1. Após concluir o atendimento
2. Clique no botão "Fechar Ticket"
3. O ticket muda para status `closed`
4. O ticket é removido da fila

### Auto-Atualização

A interface atualiza automaticamente a cada **5 segundos** (ativado por padrão).

- ✅ **Ativado**: Lista de tickets atualiza automaticamente
- ❌ **Desativado**: Atualização manual apenas

Para desativar, desmarque o checkbox "Auto-atualizar" no cabeçalho.

---

## 🔄 Fluxo de Trabalho do Atendente

### Passo a Passo

1. **Acessar Interface**
   ```
   http://localhost:3000/support
   ```

2. **Selecionar Fila**
   - Escolha a fila que você atende (ex: `suporte_n1`, `vendas`)

3. **Ver Tickets Aguardando**
   - A lista mostra todos os tickets aguardando da fila
   - Clique em um ticket para ver detalhes

4. **Atribuir Ticket**
   - Digite seu nome/ID no campo "Atribuir para"
   - Clique em "Atribuir"
   - O ticket agora está sob sua responsabilidade

5. **Enviar Mensagens**
   - Digite mensagens no campo de texto
   - Clique em "Enviar Mensagem"
   - Mensagens são enviadas via WhatsApp

6. **Fechar Ticket**
   - Após resolver o problema
   - Clique em "Fechar Ticket"
   - O ticket é arquivado

### Dicas

- **Múltiplos Tickets**: Você pode atender múltiplos tickets simultaneamente
- **Auto-Atualização**: Mantenha ativada para ver novos tickets rapidamente
- **Navegação**: Use os botões no cabeçalho para acessar outras páginas

---

## 🗺️ Navegação entre Páginas

A interface possui navegação entre diferentes páginas:

### Páginas Disponíveis

1. **Editor** (`/editor`)
   - Edição de fluxos de conversa
   - Acesso: Botão "📝 Editor" no cabeçalho

2. **Atendimento** (`/support`)
   - Interface de atendimento (página atual)
   - Acesso: Botão "💬 Atendimento" no cabeçalho

3. **Manutenção** (`/maintenance`)
   - Estatísticas e gerenciamento de filas
   - Acesso: Botão "🔧 Manutenção" no cabeçalho

4. **Configuração** (`/config`)
   - Configurações do sistema
   - Acesso: Botão "⚙️ Configuração" no cabeçalho

### Links Rápidos

- **Editor**: `http://localhost:3000/editor`
- **Atendimento**: `http://localhost:3000/support`
- **Manutenção**: `http://localhost:3000/maintenance`
- **Configuração**: `http://localhost:3000/config`

---

## 📊 Informações Exibidas

### Lista de Tickets

Cada ticket mostra:
- **ID**: Identificador único (truncado)
- **Telefone**: Número formatado (ex: `+55 (11) 99999-9999`)
- **Última Mensagem**: Última mensagem do usuário antes do handoff
- **Status**: Badge colorido (Aguardando, Em Atendimento, Fechado)

### Detalhes do Ticket

Ao selecionar um ticket, você vê:
- **ID Completo**: Identificador completo do ticket
- **Fila**: Nome da fila
- **Status**: Status atual
- **Telefone**: Número de telefone
- **Última Mensagem**: Mensagem do usuário
- **Atendente**: Quem está atendendo (se atribuído)
- **Criado em**: Data/hora de criação
- **Atualizado em**: Data/hora da última atualização

---

## ⚙️ Configuração da API

A interface se conecta à API configurada em:

**Arquivo:** `frontend/src/api/config.js`

**Configuração padrão:**
```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```

**Variáveis de Ambiente:**
```bash
# .env.local (frontend)
VITE_API_URL=http://localhost:3000
```

**Em Produção:**
```bash
VITE_API_URL=https://api.seu-dominio.com
```

---

## 🔍 Troubleshooting

### Interface não carrega

**Causa:** API não está acessível

**Solução:**
1. Verifique se o servidor está rodando:
   ```bash
   curl http://localhost:3000/health
   ```

2. Verifique a configuração da API:
   - Abra DevTools (F12)
   - Veja erros no console
   - Verifique requisições na aba Network

3. Verifique CORS:
   - Se API está em domínio diferente, configure CORS no servidor

### Tickets não aparecem

**Causa:** Fila não tem tickets ou filtro incorreto

**Solução:**
1. Verifique se há tickets na fila:
   ```bash
   curl "http://localhost:3000/queues/FILA/tickets?status=waiting"
   ```

2. Verifique se a fila existe:
   ```bash
   curl http://localhost:3000/queues
   ```

3. Verifique se auto-atualização está ativada

### Mensagens não são enviadas

**Causa:** WhatsApp não configurado ou ticket fechado

**Solução:**
1. Verifique se WhatsApp está configurado
2. Verifique se ticket não está fechado
3. Verifique logs do servidor para erros

### Auto-atualização não funciona

**Causa:** JavaScript desabilitado ou erro no console

**Solução:**
1. Verifique se JavaScript está habilitado
2. Abra DevTools (F12) e veja erros no console
3. Verifique se a API está respondendo

---

## 📱 Interface Mobile

A interface é **responsiva** e funciona em dispositivos móveis:

- ✅ Layout adaptável
- ✅ Touch-friendly
- ✅ Funciona em tablets e smartphones

**Recomendação:** Use em desktop para melhor experiência.

---

## 🔐 Segurança (Para Implementar)

### Recomendações

1. **Autenticação**
   - Implementar login/senha
   - Ou usar OAuth (Google, Microsoft, etc.)
   - Ou usar tokens JWT

2. **Autorização**
   - Controle de permissões por usuário
   - Restringir acesso a filas específicas
   - Log de ações dos atendentes

3. **HTTPS**
   - Sempre use HTTPS em produção
   - Configure certificado SSL

4. **Rate Limiting**
   - Limitar requisições por IP
   - Prevenir abuso da API

---

## 📚 Referências

- **Código da Interface**: `frontend/src/pages/SupportPage.jsx`
- **API de Tickets**: `frontend/src/api/tickets.js`
- **Rotas de Atendimento**: `docs/ROTAS_ATENDIMENTO.md`
- **Guia de Manutenção**: `docs/GUIA_MANUTENCAO_FILAS.md`

---

## 🎯 Resumo Rápido

**Para acessar:**
1. Abra navegador
2. Acesse: `http://localhost:3000/support`
3. Selecione uma fila
4. Atribua e atenda tickets

**URLs importantes:**
- Atendimento: `/support`
- Manutenção: `/maintenance`
- Editor: `/editor`
- Configuração: `/config`

**Funcionalidades principais:**
- Ver tickets aguardando
- Atribuir tickets
- Enviar mensagens via WhatsApp
- Fechar tickets

