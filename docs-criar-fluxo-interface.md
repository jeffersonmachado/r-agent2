# Guia: Criando um Fluxo de Chatbot via Interface Visual

Este guia mostra como criar um fluxo de chatbot completo usando a interface visual do editor. O exemplo cria o mesmo fluxo de atendimento básico da documentação de API, mas de forma visual e interativa.

---

## Acessando a Interface

1. **Inicie os serviços** (se ainda não estiverem rodando):
   ```bash
   docker compose --env-file .env up -d
   ```

2. **Acesse o frontend**:
   - Abra seu navegador em: `http://localhost:8080`
   - Você verá a página principal do editor de fluxos

---

## Método Alternativo: Criar via API e Editar na Interface

Se a interface não tiver menu de contexto para criar nós, você pode:

1. **Criar o fluxo básico via API** (veja `docs-criar-fluxo.md`):
   ```bash
   curl -X POST http://localhost:3000/flows \
     -H "Content-Type: application/json" \
     -d '{
       "tenantId": "tenant-demo",
       "id": "atendimento-basico",
       "name": "Atendimento Básico",
       "version": 1,
       "nodes": [
         {"id": "start-1", "type": "start", "next": "msg-1"},
         {"id": "msg-1", "type": "message", "config": {"text": "Olá!"}, "next": "end-1"},
         {"id": "end-1", "type": "end"}
       ]
     }'
   ```

2. **Carregar na interface**:
   - No campo "Flow ID" da interface, digite: `atendimento-basico`
   - Clique em "Carregar fluxo"
   - O fluxo aparecerá no editor e você pode editá-lo visualmente

---

## Interface do Editor

A interface é dividida em 4 áreas principais:

1. **Barra de Ferramentas (topo)**
   - Botões: Carregar fluxo, Salvar, Validar, Simular fluxo
   - Campo para inserir Flow ID

2. **Editor Visual (centro-esquerda)**
   - Área de desenho onde você cria e conecta nós
   - Clique com botão direito para criar novos nós
   - Arraste conexões entre nós

3. **Painel de Propriedades (centro-direita)**
   - Mostra propriedades do nó selecionado
   - Permite editar configurações específicas de cada tipo de nó

4. **Painel de Validação e Simulação (direita)**
   - Exibe resultados de validação
   - Mostra resultados de simulação

---

## Passo a Passo: Criando o Fluxo de Atendimento Básico

Vamos criar um fluxo completo que:
1. Dá boas-vindas ao usuário
2. Solicita o nome do usuário
3. Armazena o nome em uma variável
4. Oferece ajuda
5. Roteia baseado na resposta
6. Finaliza a conversa

### Passo 1: Criar o Nó de Início (start)

**Nota**: Dependendo da implementação do Rete.js, você pode criar nós de diferentes formas:
- **Menu de contexto** (botão direito): Se disponível, selecione "Add node" ou "Criar nó"
- **Atalho de teclado**: Algumas implementações usam `Ctrl+N` ou similar
- **Importar JSON**: Se não houver menu, você pode criar um fluxo mínimo via JSON (veja seção alternativa abaixo)

1. **Crie um nó** usando um dos métodos acima
2. **Clique no nó** para selecioná-lo
3. No **painel de propriedades à direita**, você verá:
   - **ID do nó**: Um número gerado automaticamente (ex: `1`)
   - **Tipo**: Campo para definir o tipo do nó
4. No campo **"Tipo"** ou na seção de configuração JSON, defina:
   ```json
   {
     "type": "start"
   }
   ```
5. O nó será renomeado automaticamente para mostrar o tipo

**Dica**: Anote o ID do nó (ex: `1`) - você precisará dele para conectar outros nós.

**Alternativa - Criar via JSON inicial**:
Se não houver menu de contexto, você pode começar com um JSON mínimo. No console do navegador (F12), execute:
```javascript
// Exemplo de como criar um nó programaticamente (se a API estiver exposta)
// Isso pode variar dependendo da implementação
```

### Passo 2: Criar a Mensagem de Boas-Vindas (message)

1. **Clique com botão direito** novamente e crie outro nó
2. **Selecione o novo nó** e configure:
   - **Tipo**: `message`
   - **Configuração JSON** ou use o formulário específico:
     ```json
     {
       "text": "Olá! Bem-vindo ao nosso atendimento. Qual é o seu nome?"
     }
     ```
   - Se houver um campo de texto específico para mensagens, digite: `Olá! Bem-vindo ao nosso atendimento. Qual é o seu nome?`

3. **Conecte o nó start ao nó message**:
   - Clique no **ponto verde** (saída) do nó `start`
   - Arraste até o **ponto azul** (entrada) do nó `message`
   - Uma linha de conexão será criada

### Passo 3: Criar o Nó de Entrada do Usuário (user_input)

1. **Crie um novo nó** e configure:
   - **Tipo**: `user_input`
   - **Configuração**:
     ```json
     {
       "variable": "userName"
     }
     ```
   - Ou use o campo específico "Variável de destino": `userName`

2. **Conecte** o nó `message` ao nó `user_input`

### Passo 4: Criar a Mensagem de Ajuda (message)

1. **Crie outro nó do tipo `message`** e configure:
   - **Texto**: `Olá, {{userName}}! Como posso ajudar você hoje? (Digite 'sim' para ajuda ou 'não' para encerrar)`
   
   **Nota**: O template `{{userName}}` será substituído pelo valor da variável durante a execução.

2. **Conecte** o nó `user_input` ao novo nó `message`

### Passo 5: Criar o Segundo Nó de Entrada (user_input)

1. **Crie um novo nó `user_input`** e configure:
   - **Variável de destino**: `userMessage`

2. **Conecte** a mensagem anterior a este nó

### Passo 6: Criar o Nó de Roteamento (router)

1. **Crie um novo nó** e configure:
   - **Tipo**: `router`
   - **Configuração JSON** (use o editor JSON bruto):
     ```json
     {
       "rules": [
         {
           "condition": {
             "op": "equals",
             "var": "userMessage",
             "value": "sim"
           },
           "next": "msg-ajuda-detalhada"
         },
         {
           "condition": {
             "op": "equals",
             "var": "userMessage",
             "value": "não"
           },
           "next": "msg-despedida"
         },
         {
           "condition": {
             "op": "always"
           },
           "next": "msg-default"
         }
       ]
     }
     ```

   **Importante**: Os IDs `"msg-ajuda-detalhada"`, `"msg-despedida"` e `"msg-default"` serão os IDs dos nós que você criará a seguir. Anote os IDs numéricos reais dos nós que você criar.

2. **Conecte** o nó `user_input` anterior ao nó `router`

### Passo 7: Criar as Mensagens de Resposta

Crie três novos nós do tipo `message`:

#### 7a. Mensagem de Ajuda Detalhada
- **ID do nó**: Anote este número (ex: `7`)
- **Tipo**: `message`
- **Texto**: `Perfeito! Vou te ajudar. Em que posso ser útil?`
- **Não conecte ainda** - o router decidirá quando usar este nó

#### 7b. Mensagem de Despedida
- **ID do nó**: Anote este número (ex: `8`)
- **Tipo**: `message`
- **Texto**: `Tudo bem, {{userName}}! Foi um prazer ajudar. Até logo!`

#### 7c. Mensagem Padrão (Fallback)
- **ID do nó**: Anote este número (ex: `9`)
- **Tipo**: `message`
- **Texto**: `Desculpe, não entendi. Por favor, digite 'sim' ou 'não'.`

### Passo 8: Atualizar o Router com os IDs Corretos

1. **Selecione o nó router** novamente
2. **Atualize a configuração JSON** substituindo os IDs pelos números reais dos nós:
   ```json
   {
     "rules": [
       {
         "condition": {
           "op": "equals",
           "var": "userMessage",
           "value": "sim"
         },
         "next": "7"
       },
       {
         "condition": {
           "op": "equals",
           "var": "userMessage",
           "value": "não"
         },
         "next": "8"
       },
       {
         "condition": {
           "op": "always"
         },
         "next": "9"
       }
     ]
   }
   ```

**Nota**: Em uma versão futura, a interface pode permitir selecionar nós visualmente para preencher esses IDs automaticamente.

### Passo 9: Criar o Nó de Handoff

1. **Crie um novo nó** do tipo `handoff` e configure:
   - **Fila de atendimento**: `suporte`
   - Ou via JSON:
     ```json
     {
       "queue": "suporte"
     }
     ```

2. **Conecte** a mensagem de ajuda detalhada ao nó `handoff`

### Passo 10: Criar o Nó de Fim (end)

1. **Crie um novo nó** do tipo `end`
2. **Conecte**:
   - O nó `handoff` ao nó `end`
   - A mensagem de despedida ao nó `end`
   - A mensagem padrão pode voltar ao nó de entrada anterior (criando um loop) ou ir para `end`

### Passo 11: Ajustar a Mensagem Padrão (Loop)

Para criar um loop de retry, conecte a mensagem padrão de volta ao nó de entrada `user_input` que captura `userMessage`:

1. **Clique no ponto verde** (saída) da mensagem padrão
2. **Arraste até o ponto azul** (entrada) do nó `user_input` que tem `variable: "userMessage"`

---

## Validando o Fluxo

Antes de salvar, valide o fluxo:

1. **Clique no botão "Validar"** na barra de ferramentas
2. O **painel de validação** (lado direito) mostrará:
   - ✅ **Válido** - se não houver erros
   - ❌ **Inválido** - com lista de erros encontrados

**Erros comuns**:
- Nós desconectados (não alcançáveis a partir do start)
- Conexões inválidas entre tipos de nós
- Loops inválidos

**Corrija os erros** antes de continuar.

---

## Salvando o Fluxo

1. **Na barra de ferramentas**, no campo "Flow ID", digite um ID único:
   - Exemplo: `atendimento-basico`

2. **Clique no botão "Salvar"**
   - O fluxo será salvo no backend
   - Uma mensagem de confirmação aparecerá (ou o nome do fluxo será atualizado no topo)

**Importante**: 
- O fluxo precisa ter um nó `start` para ser válido
- O fluxo precisa ter pelo menos um nó `end` para ser válido
- Todos os nós devem estar conectados e alcançáveis

---

## Simulando o Fluxo

Após salvar, você pode simular o fluxo:

1. **Clique no botão "Simular fluxo"** na barra de ferramentas
2. O **painel de simulação** (parte inferior direita) mostrará:
   - Passos executados
   - Estado antes e depois de cada passo
   - Output de cada nó
   - Eventos gerados

3. **Analise os resultados**:
   - Verifique se o fluxo executa como esperado
   - Confira se as variáveis são armazenadas corretamente
   - Veja se o roteamento funciona

---

## Carregando um Fluxo Existente

Para editar um fluxo já salvo:

1. **No campo "Flow ID"** na barra de ferramentas, digite o ID do fluxo
2. **Clique no botão "Carregar fluxo"**
3. O fluxo será carregado e exibido no editor

---

## Dicas e Boas Práticas

### Organização Visual

- **Arraste os nós** para organizá-los melhor
- **Use zoom** (scroll do mouse) para navegar em fluxos grandes
- **Agrupe nós relacionados** visualmente

### Nomenclatura

- **Use IDs descritivos** quando possível (embora o editor gere números)
- **Anote os IDs** dos nós importantes para referência futura

### Validação Contínua

- **Valide frequentemente** durante a criação
- **Corrija erros imediatamente** para evitar acúmulo

### Testes

- **Simule após cada mudança significativa**
- **Teste diferentes caminhos** do fluxo
- **Verifique se as variáveis são armazenadas corretamente**

### Conexões

- **Cada nó pode ter apenas uma conexão de saída** (o campo `next`)
- **Para roteamento condicional**, use o nó `router`
- **Conexões inválidas são automaticamente rejeitadas** pela interface

---

## Estrutura Visual do Fluxo Completo

```
[start] 
   ↓
[message: "Olá! Bem-vindo..."]
   ↓
[user_input: variable="userName"]
   ↓
[message: "Olá, {{userName}}!..."]
   ↓
[user_input: variable="userMessage"]
   ↓
[router: rules=[...]]
   ├─→ (se "sim") → [message: "Perfeito!..."] → [handoff] → [end]
   ├─→ (se "não") → [message: "Tudo bem..."] → [end]
   └─→ (sempre) → [message: "Desculpe..."] → (loop) → [user_input]
```

---

## Resolução de Problemas

### Como criar nós se não houver menu de contexto
Se a interface não tiver menu de contexto implementado, você pode:
1. **Usar a API diretamente**: Crie o fluxo via API (veja `docs-criar-fluxo.md`) e depois carregue-o na interface
2. **Importar JSON**: Use a funcionalidade de importar JSON (se disponível no toolbar)
3. **Editar JSON diretamente**: Algumas versões podem permitir editar o JSON do fluxo diretamente

### Nó não aparece no editor
- Verifique se você clicou com botão direito na área de desenho
- Tente usar atalhos de teclado (se disponíveis)
- Recarregue a página se necessário
- Considere criar o fluxo via API e carregá-lo na interface

### Conexão não funciona
- Verifique se os tipos de nós são compatíveis (veja tabela abaixo)
- Certifique-se de arrastar do ponto verde (saída) para o ponto azul (entrada)

### Validação falha
- Verifique se há um nó `start`
- Verifique se há pelo menos um nó `end`
- Certifique-se de que todos os nós estão conectados
- Verifique se não há loops inválidos

### Simulação não funciona
- Certifique-se de que o fluxo foi salvo primeiro
- Verifique se o Flow ID está correto
- Confira os logs do console do navegador (F12)

---

## Tabela de Compatibilidade de Conexões

| De | Para |
|----|------|
| `start` | `message`, `user_input`, `router`, `set_variable`, `handoff`, `ai`, `end` |
| `message` | `user_input`, `router`, `set_variable`, `handoff`, `ai`, `end` |
| `user_input` | `router`, `message`, `set_variable`, `handoff`, `ai`, `end` |
| `router` | `message`, `user_input`, `set_variable`, `handoff`, `ai`, `end` |
| `set_variable` | `message`, `user_input`, `router`, `handoff`, `ai`, `end` |
| `ai` | `message`, `user_input`, `router`, `set_variable`, `handoff`, `end` |
| `handoff` | `end` |
| `end` | (nenhum) |

**Nota**: A interface impede conexões inválidas automaticamente.

**Exemplos de conexões inválidas:**
- `handoff` → `message` ❌ (handoff só pode ir para `end`)
- `end` → qualquer nó ❌ (end não pode ter conexões de saída)

---

## Próximos Passos

- Explore fluxos mais complexos com múltiplos routers
- Adicione nós de IA para processamento de linguagem natural
- Use variáveis para criar fluxos dinâmicos
- Integre com sistemas externos via handoff

---

## Referências

- Documentação da API: `docs-deploy.md`
- Guia de criação via API: `docs-criar-fluxo.md`
- Código do editor: `frontend/src/FlowEditor.jsx`

