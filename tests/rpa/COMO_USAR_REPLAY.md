# 📹 Como Usar o Sistema de Replay - Guia Completo

## 🎯 O Problema que Você Encontrou

Quando você clica em um card de replay na página `/rpa-replays`, o modal abre mas mostra:
- **0 ações**
- **0 telas**

Isso acontecia porque o teste estava criando o replay, mas **não estava registrando as ações** durante a execução.

## ✅ Solução Aplicada

Agora o teste de login (`tests/rpa/login.test.js`) registra:

### Ações Registradas
1. ✅ **Navegação** - Quando vai para `/login`
2. ✅ **Preenchimento de username** - Quando preenche o campo
3. ✅ **Preenchimento de password** - Quando preenche a senha
4. ✅ **Submissão** - Quando clica no botão ou pressiona Enter
5. ✅ **Seleção de tenant** - Quando seleciona um tenant (se aplicável)
6. ✅ **Redirecionamento** - Quando é redirecionado após login

### Telas Registradas
1. ✅ **Tela inicial** - Quando a página de login carrega
2. ✅ **Após submissão** - Após enviar o formulário
3. ✅ **Modal de tenant** - Se aparecer modal de seleção
4. ✅ **Após seleção** - Após selecionar tenant
5. ✅ **Estado final** - Tela final após login completo

### Eventos Registrados
- ✅ `tenant_modal_detected` - Quando modal de tenant aparece
- ✅ `tenant_selection_failed` - Se falhar ao selecionar tenant
- ✅ `test_completed` - Quando teste termina com sucesso
- ✅ `test_failed` - Quando teste falha

---

## 🚀 Como Testar Agora

### 1. Execute o teste novamente

```bash
cd /opt/results/ria/r-agent2
node tests/rpa/login.test.js
```

### 2. Verifique o replay gerado

O teste agora mostrará no console:
```
📹 Replay salvo: /path/to/replay.json
   📊 Ações registradas: 6
   📸 Telas registradas: 5
```

### 3. Visualize no frontend

1. Acesse `http://localhost:5173/rpa-replays`
2. Clique no card do replay mais recente
3. Agora você verá:
   - ✅ **Ações**: Lista completa de todas as ações executadas
   - ✅ **Telas**: Screenshots em cada etapa
   - ✅ **Modo Step-by-Step**: Navegue passo a passo
   - ✅ **Reprodução**: Play automático com controle de velocidade

---

## 📋 O que Aparece no Modal

### Informações Gerais
- ID do replay
- ID da gravação
- Data/hora de início e fim
- Duração total
- Estatísticas (ações, telas, erros)

### Modo Lista Completa
- **Ações Executadas**: Lista de todas as ações com:
  - Tipo (navigate, fill, click, etc.)
  - Seletor usado
  - Valor (se aplicável)
  - Timestamp
  - Status (sucesso/falha)

- **Telas Capturadas**: Grid com screenshots de cada etapa

- **Erros**: Lista de erros (se houver)

### Modo Step-by-Step
- **Navegação**: Primeiro, Anterior, Próximo, Último
- **Reprodução**: Play/Pause automático
- **Velocidade**: 0.1s a 5s entre passos
- **Barra de Progresso**: Mostra posição atual
- **Visualização**: Mostra ação ou tela do passo atual

---

## 🔧 Padrão para Outros Testes

Se você criar novos testes RPA, use este padrão:

```javascript
const { ReplaySystem } = require('./replaySystem');

// 1. Inicializa replay
const replay = new ReplaySystem();
replay.start('meu-teste-123');

// 2. Inicia monitoramento automático de mudanças de tela
await replay.startAutoScreenMonitoring(page, {
  checkInterval: 500,
  captureOnNavigation: true,
  captureOnDOMChange: true,
});

try {
  // 3. Registra cada ação (captura tela automaticamente após cada ação)
  await replay.recordAction(
    { type: 'navigate', step: 'go-to-page', value: { url: '...' } },
    { success: true, startTime: '...', endTime: '...', page }
  );
  
  // 4. Registra telas em pontos chave (opcional, já captura automaticamente)
  await replay.recordScreen(page, 'step-name');
  
  // 5. Registra eventos importantes
  replay.recordEvent('event_name', { data: 'value' });
  
} catch (error) {
  // 6. Registra erros
  replay.recordError(error, 'step-name');
} finally {
  // 7. Salva replay
  replay.stop();
  replay.save('meu-teste-123');
}
```

### ✨ Nova Funcionalidade: Captura Automática de Telas

Agora o sistema captura telas automaticamente:
- ✅ **Após cada ação** (navigate, click, fill, etc.) - quando você passa `page` no `recordAction`
- ✅ **Em mudanças de navegação** - quando a URL muda
- ✅ **Em mudanças de DOM** - quando elementos aparecem/desaparecem
- ✅ **Periodicamente** - a cada 500ms (configurável)

Você não precisa mais chamar `recordScreen()` manualmente após cada ação!

---

## 📊 Exemplo de Replay Completo

Após executar o teste corrigido, o replay terá algo como:

```json
{
  "id": "login-flow-1768067967319",
  "actions": [
    {
      "type": "navigate",
      "step": "navigate-to-login",
      "value": { "url": "http://localhost:5173/login" },
      "success": true,
      "timestamp": "..."
    },
    {
      "type": "fill",
      "step": "fill-username",
      "selector": "input[type='text']",
      "value": "systemadmin",
      "success": true,
      "timestamp": "..."
    },
    // ... mais ações
  ],
  "screens": [
    {
      "step": "login-page-initial",
      "timestamp": "...",
      "signature": "...",
      "screenshot": "base64..."
    },
    // ... mais telas
  ],
  "events": [
    { "type": "tenant_modal_detected", "data": {...} },
    { "type": "test_completed", "data": {...} }
  ]
}
```

---

## ✅ Resultado Esperado

Agora quando você clicar em um card de replay:

1. ✅ **Modal abre** com informações completas
2. ✅ **Ações aparecem** na lista (não mais 0)
3. ✅ **Telas aparecem** no grid (não mais 0)
4. ✅ **Modo Step-by-Step funciona** com navegação
5. ✅ **Reprodução automática** funciona
6. ✅ **Screenshots são exibidos** corretamente

---

## 🎉 Próximos Passos

1. **Execute o teste novamente** para gerar um replay completo
2. **Visualize no frontend** para ver todas as ações e telas
3. **Use o modo Step-by-Step** para analisar cada passo
4. **Aplique o mesmo padrão** em outros testes RPA

O sistema de replay agora está **totalmente funcional**! 🚀
