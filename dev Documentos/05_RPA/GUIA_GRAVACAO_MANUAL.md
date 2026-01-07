# 🎬 Guia Completo: Gravações Manuais RPA

## O que são Gravações Manuais?

**Gravações manuais** são seeds RPA criados através da **interação humana direta** com o navegador. Você abre o navegador, interage com a interface (clica, digita, navega), e o sistema **grava automaticamente** todas as suas ações em um arquivo seed.

### Características Principais

- ✅ **Interação visual**: Você vê o navegador e interage normalmente
- ✅ **Gravação automática**: O sistema captura todas as ações automaticamente
- ✅ **Digitação visível**: Cada caractere é digitado visivelmente (não instantâneo)
- ✅ **Seed puro**: O arquivo gerado contém apenas **O QUE foi feito**, não **COMO** (sem delays/velocidade)
- ✅ **Replay automático**: Um replay é gerado automaticamente para debug

## Como Fazer uma Gravação Manual

### Passo 1: Executar o Script de Gravação

```bash
node tests/rpa/gravar-seed-rpa.js <nome-do-seed> [url-inicial]
```

**Exemplo:**
```bash
# Gravar um seed de login
node tests/rpa/gravar-seed-rpa.js meu-login http://localhost:5173

# Gravar um seed de criação de fluxo
node tests/rpa/gravar-seed-rpa.js criar-fluxo http://localhost:5173/flows
```

### Passo 2: Interagir com o Navegador

Quando o script iniciar:

1. **Navegador abre automaticamente** na URL especificada
2. **Gravação inicia** automaticamente
3. **Você interage normalmente**:
   - Clique em botões
   - Digite em campos (digitação será visível, caractere a caractere)
   - Navegue pela aplicação
   - Preencha formulários
   - Selecione opções em dropdowns

### Passo 3: Parar a Gravação

Quando terminar:
- Pressione **Ctrl+C** no terminal
- O sistema salvará automaticamente:
  - ✅ Seed em `/tests/rpa/seeds/<nome-do-seed>.json`
  - ✅ Replay em `/tests/rpa/replay/replay-record-<nome>-<timestamp>.json`

## O que é Gravado?

O sistema grava automaticamente:

### 1. Navegação
```json
{
  "type": "navigate",
  "url": "http://localhost:5173/login"
}
```

### 2. Cliques
```json
{
  "type": "click",
  "selector": "button:has-text('Entrar')"
}
```

### 3. Digitação
```json
{
  "type": "fill",
  "selector": "input[name='email']",
  "value": "admin@example.com"
}
```

### 4. Seleções
```json
{
  "type": "select",
  "selector": "select[name='department']",
  "value": "suporte"
}
```

### 5. Validações (Asserts)
```json
{
  "type": "assert",
  "selector": "h1:has-text('Dashboard')",
  "condition": "visible"
}
```

## Como Funciona Internamente

### 1. Inicialização

```javascript
const recorder = new RpaRecorder({
  mode: 'record',
  seedName: 'meu-login',
});

await recorder.init(); // Abre navegador
await recorder.startRecording(url); // Inicia gravação
```

### 2. Interceptação de Ações

O sistema intercepta eventos do navegador:

```javascript
// Intercepta cliques
page.on('click', async (event) => {
  const selector = await getElementSelector(event.target);
  recorder.recordClick(selector);
});

// Intercepta digitação
page.on('input', async (event) => {
  const selector = await getElementSelector(event.target);
  const value = await event.target.value();
  recorder.recordFill(selector, value);
});
```

### 3. Digitação Visível

A digitação é feita **caractere a caractere** para ser visível:

```javascript
// Digita caractere a caractere com delay configurável
for (const char of text) {
  await page.type(selector, char, { delay: typingSpeedMs });
}
```

### 4. Salvamento

Quando você pressiona Ctrl+C:

```javascript
await recorder.stopRecording();
// Salva seed em /tests/rpa/seeds/
// Gera replay em /tests/rpa/replay/
```

## Exemplo Prático Completo

### Cenário: Gravar Login

```bash
# 1. Iniciar gravação
node tests/rpa/gravar-seed-rpa.js login-admin http://localhost:5173
```

**No navegador que abrir:**
1. Digite o email: `admin@example.com`
2. Digite a senha: `admin123`
3. Clique no botão "Entrar"
4. Aguarde o dashboard carregar

**No terminal:**
- Pressione `Ctrl+C`

**Resultado:**
```json
// /tests/rpa/seeds/login-admin.json
{
  "id": "login-admin",
  "name": "login-admin",
  "version": "1.0.0",
  "createdAt": "2026-01-05T...",
  "steps": [
    {
      "type": "navigate",
      "url": "http://localhost:5173"
    },
    {
      "type": "fill",
      "selector": "input[name='email']",
      "value": "admin@example.com"
    },
    {
      "type": "fill",
      "selector": "input[name='password']",
      "value": "admin123"
    },
    {
      "type": "click",
      "selector": "button:has-text('Entrar')"
    },
    {
      "type": "wait",
      "condition": "networkidle"
    }
  ]
}
```

## Características Importantes

### ✅ O que o Seed CONTÉM

- ✅ **Ações**: O que foi feito (cliques, digitação, navegação)
- ✅ **Seletores**: Como encontrar os elementos
- ✅ **Valores**: O que foi digitado/selecionado
- ✅ **Ordem**: Sequência das ações

### ❌ O que o Seed NÃO contém

- ❌ **Delays**: Não há delays hardcoded
- ❌ **Velocidade**: Não há velocidade de digitação
- ❌ **Timing**: Não há timestamps de execução
- ❌ **Config**: Não inclui configurações de modo

**Por quê?** O seed descreve **O QUE fazer**, não **COMO fazer**. A velocidade é controlada pelo `rpa.config.json` durante a execução.

## Configuração de Velocidade

A velocidade de digitação é controlada por `rpa.config.json`:

```json
{
  "modes": {
    "record": {
      "typingSpeedMs": 50,        // 50ms por caractere
      "actionDelayMs": 200,        // 200ms entre ações
      "screenStabilizeMs": 500    // 500ms para estabilizar tela
    }
  }
}
```

**Durante a gravação**: Usa a velocidade configurada para digitação visível
**No seed salvo**: Não salva a velocidade, apenas o texto completo

## Replay Automático

Toda gravação manual gera automaticamente um **replay**:

```
/tests/rpa/replay/replay-record-<nome>-<timestamp>.json
```

O replay contém:
- 📸 Screenshots de cada tela
- ⏱️ Timestamps de cada ação
- ✅ Status de sucesso/erro
- 📊 Métricas de performance

## Dicas e Boas Práticas

### ✅ Faça

- ✅ **Use seletores estáveis**: Prefira `data-testid` ou IDs
- ✅ **Aguarde carregamentos**: Use `wait` quando necessário
- ✅ **Valide resultados**: Adicione `assert` para validar estados
- ✅ **Nomes descritivos**: Use nomes claros para os seeds
- ✅ **Teste o seed**: Execute após gravar para validar

### ❌ Evite

- ❌ **Seletores frágeis**: Evite seletores baseados em posição
- ❌ **Ações muito rápidas**: Deixe o sistema estabilizar entre ações
- ❌ **Dados hardcoded**: Use variáveis quando possível
- ❌ **Gravações muito longas**: Quebre em seeds menores

## Exemplos de Uso

### 1. Seed de Login
```bash
node tests/rpa/gravar-seed-rpa.js seed-platform-login http://localhost:5173
```

### 2. Seed de Criação de Fluxo
```bash
node tests/rpa/gravar-seed-rpa.js seed-platform-create-flow http://localhost:5173/flows
```

### 3. Seed de Criação de Agente
```bash
node tests/rpa/gravar-seed-rpa.js seed-platform-create-agent http://localhost:5173/agents
```

## Verificar Gravação

Após gravar, você pode:

```bash
# Ver o seed criado
cat tests/rpa/seeds/<nome>.json | jq '.'

# Ver o replay
cat tests/rpa/replay/replay-record-<nome>-*.json | jq '.'

# Executar o seed visualmente
node tests/rpa/ver-seed-rpa.js <nome>

# Executar o seed em modo CI (rápido)
node tests/rpa/cli.js ci <nome>
```

## Resumo

| Aspecto | Detalhe |
|---------|---------|
| **O que é** | Seed criado através de interação humana |
| **Como fazer** | `node tests/rpa/gravar-seed-rpa.js <nome> [url]` |
| **Onde salva** | `/tests/rpa/seeds/<nome>.json` |
| **O que grava** | Ações (cliques, digitação, navegação) |
| **O que NÃO grava** | Delays, velocidade, timing |
| **Replay** | Gerado automaticamente |
| **Velocidade** | Controlada por `rpa.config.json` |

---

**Gravações manuais são a base do sistema RPA**: Elas permitem criar seeds de forma intuitiva, apenas interagindo com a interface como um usuário normal faria.

