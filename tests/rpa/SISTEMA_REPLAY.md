# 🎬 Sistema de Replay

## 📋 Visão Geral

O **Sistema de Replay** é um **módulo reutilizável** que permite gravar, armazenar, visualizar e executar novamente qualquer tipo de processo automatizado de forma determinística. Ele captura todas as ações executadas, incluindo navegações, cliques, preenchimentos, chamadas de API, telas capturadas e erros.

### 🎯 Módulo Centralizado

O módulo principal está localizado em: **`lib/replaySystem.js`**

Ele pode ser usado em:
- ✅ Testes RPA (Playwright)
- ✅ Testes de API
- ✅ Processos de geração (IA, fluxos, seeds)
- ✅ Workflows/Orquestração
- ✅ Qualquer processo automatizado

## 🎯 Funcionalidades Principais

### 1. **Gravação Automática**
- Captura todas as ações durante a execução de testes RPA
- Registra telas (screenshots) em pontos-chave
- Armazena timestamps e durações
- Detecta e registra erros automaticamente

### 2. **Armazenamento**
- Replays são salvos em formato JSON
- Localização: `tests/rpa/replay/`
- Formato: `replay-{id}-{timestamp}.json` ou `{nome}-{timestamp}.json`

### 3. **Visualização**
- Interface web completa em `/rpa-replays`
- Modal interativo com dois modos:
  - **Modo Step-by-Step**: Navegação passo a passo
  - **Modo Lista Completa**: Visualização de todas as ações
- Informações detalhadas de cada ação
- Screenshots integrados

### 4. **Execução**
- Re-executa replays gravados
- Suporta execução automática ou manual
- Modo visual (headless=false) ou headless

## 📁 Estrutura de Arquivos

```
tests/rpa/
├── replay/                    # Diretório de replays
│   ├── login-flow-*.json     # Replays de login
│   └── replay-*.json         # Outros replays
├── screenshots/              # Screenshots capturados
│   └── login-*.png
├── replaySystem.js           # Sistema de replay (core)
├── ver-replay-login.js       # Visualizador de replays
├── executar-replay-login.js  # Executor de replays
└── COMO_VER_REPLAY.md        # Guia de uso
```

## 🔧 Componentes do Sistema

### Backend (Node.js)

#### `replaySystem.js`
Classe principal que gerencia replays:
- `ReplaySystem`: Gerencia gravação e armazenamento
- `generateScreenSignature()`: Gera assinatura de tela
- `save()`: Salva replay em arquivo
- `load()`: Carrega replay de arquivo
- `generateDiff()`: Compara dois replays

#### `login.test.js`
Teste RPA que gera replays automaticamente:
- Integra com `ReplaySystem`
- Captura ações durante execução
- Salva replay ao finalizar

### Frontend (React)

#### `RpaReplaysPage.jsx`
Página principal de visualização:
- Lista todos os replays disponíveis
- Filtros e ordenação
- Modal de visualização detalhada
- Modo step-by-step e lista completa

#### `GenerateSystemPage.jsx`
Integração com sistema de geração:
- Exibe replays de testes executados
- Permite clicar em Replay ID para visualizar
- Executa replay via API

## 📊 Estrutura de Dados do Replay

```json
{
  "id": "replay-1768067967320",
  "recordingId": "login-flow-1768067967319",
  "startTime": "2026-01-10T17:59:27.320Z",
  "endTime": "2026-01-10T17:59:43.500Z",
  "screens": [
    {
      "step": 1,
      "signature": "abc123",
      "signatureData": {
        "title": "Login",
        "url": "http://localhost:5173/login",
        "elements": [...]
      },
      "timestamp": "2026-01-10T17:59:27.320Z"
    }
  ],
  "actions": [
    {
      "step": 1,
      "type": "navigate",
      "url": "http://localhost:5173/login",
      "timestamp": "2026-01-10T17:59:27.320Z",
      "success": true
    },
    {
      "step": 2,
      "type": "fill",
      "selector": "input[type='text']",
      "value": "systemadmin",
      "timestamp": "2026-01-10T17:59:28.500Z",
      "success": true
    }
  ],
  "timings": {
    "total": 16180,
    "steps": {}
  },
  "errors": []
}
```

## 🚀 Como Usar

### 1. Gerar um Replay

```bash
# Executar teste que gera replay automaticamente
node tests/rpa/login.test.js
```

### 2. Visualizar Replays

#### Via CLI
```bash
# Listar replays disponíveis
node tests/rpa/ver-replay-login.js

# Ver replay específico
node tests/rpa/ver-replay-login.js login-flow-1768067967319
```

#### Via Interface Web
1. Acesse: `http://localhost:5173/rpa-replays`
2. Clique em um card de replay
3. Visualize informações detalhadas
4. Use "Modo Step-by-Step" para navegar passo a passo

### 3. Executar um Replay

```bash
# Executar replay
node tests/rpa/executar-replay-login.js login-flow-1768067967319

# Modo visual
HEADLESS=false node tests/rpa/executar-replay-login.js login-flow-1768067967319
```

### 4. Via Interface Web (GenerateSystemPage)

1. Execute um teste RPA
2. No resultado, localize o "Replay ID"
3. Clique no Replay ID
4. O modal abre com o replay
5. Use os controles para navegar

## 🎨 Modos de Visualização

### Modo Step-by-Step
- Navegação passo a passo
- Controles: Primeiro, Anterior, Próximo, Último
- Barra de progresso
- Detalhes completos de cada ação
- Screenshots quando disponíveis

### Modo Lista Completa
- Lista todas as ações
- Scroll infinito
- Filtros e busca
- Visualização compacta

## 🔍 Funcionalidades Avançadas

### Comparação de Replays
```javascript
const diff = ReplaySystem.generateDiff(expectedReplay, actualReplay);
```

### Assinatura de Telas
Gera hash único baseado em elementos visíveis da página para comparação.

### Detecção de Diferenças
Compara replays e identifica:
- Telas diferentes
- Ações diferentes
- Timings diferentes
- Erros novos

## 📝 Integração com Testes

### Em Testes RPA

```javascript
const replaySystem = new ReplaySystem();
const replayId = `test-${Date.now()}`;

replaySystem.start(replayId);

// ... executa ações ...

replaySystem.stop();
const replayPath = replaySystem.save(replayId);
```

### Em Testes Automatizados

O sistema de replay é integrado automaticamente em:
- `login.test.js` - Teste de login
- `rpaTestRunner.js` - Runner principal
- Testes via `GenerateSystemPage`

## 🎯 Casos de Uso

1. **Debug de Testes**: Ver exatamente o que aconteceu durante um teste
2. **Regressão**: Comparar execuções diferentes
3. **Documentação**: Criar documentação visual de fluxos
4. **Treinamento**: Mostrar como um teste funciona
5. **Análise**: Identificar pontos de falha

## 🔧 Configuração

### Variáveis de Ambiente

```bash
FRONTEND_URL=http://localhost:5173
API_URL=http://localhost:3000
HEADLESS=false  # Para modo visual
```

### Configuração de Replay

```javascript
const replaySystem = new ReplaySystem({
  enableScreenshots: true,
  enableActions: true,
  enableTimings: true
});
```

## 📈 Estatísticas

O sistema de replay captura:
- ✅ Número de ações executadas
- ✅ Número de telas capturadas
- ✅ Duração total
- ✅ Erros encontrados
- ✅ Timestamps de cada ação
- ✅ Seletores usados
- ✅ Valores preenchidos

## 🐛 Troubleshooting

### Replay não está sendo gerado
- Verifique se `ReplaySystem` está sendo inicializado
- Confirme que `replaySystem.start()` foi chamado
- Verifique permissões de escrita em `tests/rpa/replay/`

### Replay não tem ações
- O replay pode ter sido criado mas não teve ações registradas
- Verifique se as ações estão sendo capturadas durante execução

### Erro ao visualizar replay
- Verifique se o arquivo JSON está válido
- Confirme que o arquivo existe em `tests/rpa/replay/`

## 🔮 Melhorias Futuras

- [ ] Reprodução automática de replays
- [ ] Comparação visual de replays
- [ ] Exportação de replays para vídeo
- [ ] Análise de performance baseada em replays
- [ ] Integração com CI/CD

## 📚 Referências

- [COMO_VER_REPLAY.md](./COMO_VER_REPLAY.md) - Guia de visualização
- [README_LOGIN.md](./README_LOGIN.md) - Teste de login
- [lib/replaySystem.js](../../lib/replaySystem.js) - ⭐ Módulo principal reutilizável
- [lib/README_REPLAY_SYSTEM.md](../../lib/README_REPLAY_SYSTEM.md) - Documentação completa do módulo
- [lib/replaySystem.examples.js](../../lib/replaySystem.examples.js) - Exemplos de uso
- [lib/REPLAY_SYSTEM_USAGE.md](../../lib/REPLAY_SYSTEM_USAGE.md) - Guia de uso por contexto

## ✅ Conclusão

O **Sistema de Replay** é uma ferramenta poderosa para:
- ✅ Debug e análise de testes
- ✅ Documentação visual
- ✅ Regressão e comparação
- ✅ Treinamento e demonstração

Ele está totalmente integrado ao sistema de testes RPA e pode ser usado tanto via CLI quanto via interface web.
