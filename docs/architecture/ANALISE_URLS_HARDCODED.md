# Análise: URLs Hardcoded sem considerar config.json

Este documento lista todos os locais onde URLs estão hardcoded no código sem considerar o arquivo `api/data/config.json`.

## Resumo

Foram identificados **múltiplos arquivos** que utilizam URLs hardcoded (`http://localhost:3000` ou `http://localhost:5173`) sem consultar o `config.json`. Isso dificulta a configuração em diferentes ambientes (desenvolvimento, staging, produção).

## Arquivos Identificados

### Frontend

#### 1. `frontend/src/hooks/useWebSocket.js`
- **Linha 47**: `const DEFAULT_BASE_URL = 'http://localhost:3000';`
- **Problema**: URL hardcoded para WebSocket
- **Solução sugerida**: Usar `config.get('frontend.apiBaseUrl')` ou variável de ambiente

#### 2. `frontend/src/api/client.js`
- **Linha 27**: `const DEFAULT_BASE_URL = 'http://localhost:3000';`
- **Linhas 81, 231**: Logs com fallback hardcoded
- **Problema**: URL hardcoded como fallback
- **Solução sugerida**: Usar `config.get('frontend.apiBaseUrl')` ou variável de ambiente

### Backend/Services

#### 3. `api/services/rpaTestGeneratorService.js`
- **Linha 74**: `'http://localhost:5173'` (fallback para frontend URL)
- **Linha 586**: `'http://localhost:5173'` (outro fallback)
- **Problema**: URL do frontend hardcoded
- **Solução sugerida**: Usar `config.get('frontend.apiBaseUrl')` ou `config.get('frontend.url')`

#### 4. `api/services/rpaService.js`
- **Linha 408**: `process.env.API_BASE_URL || 'http://localhost:3000'`
- **Problema**: Fallback hardcoded
- **Solução sugerida**: Usar `config.get('api.baseUrl')` ou `config.get('api.url')`

#### 5. `engine/ai/generateRpaTest.js`
- **Linha 75**: `value: "http://localhost:3000"`
- **Problema**: URL hardcoded em contrato
- **Solução sugerida**: Usar `config.get('api.baseUrl')`

### Testes RPA

#### 6. `tests/rpa/utils/urlNormalizer.js`
- **Linha 20**: `'http://localhost:5173'` (fallback)
- **Problema**: URL do frontend hardcoded
- **Solução sugerida**: Usar configuração do `rpa.config.json` ou `config.json`

#### 7. `tests/rpa/rpaTestRunner.js`
- **Linhas 138, 144, 150**: `process.env.TEST_FRONTEND_URL || 'http://localhost:5173'`
- **Problema**: Fallback hardcoded
- **Solução sugerida**: Usar `rpa.config.json` que já existe

#### 8. `tests/rpa/player/rpaPlayer.js`
- **Linhas 224, 230, 236**: `process.env.TEST_FRONTEND_URL || 'http://localhost:5173'`
- **Problema**: Fallback hardcoded
- **Solução sugerida**: Usar `rpa.config.json` que já existe

#### 9. `tests/rpa/utils/authHelper.js`
- **Linha 207**: `'http://localhost:3000'` (fallback)
- **Problema**: URL da API hardcoded
- **Solução sugerida**: Usar `rpa.config.json` ou `config.json`

#### 10. `tests/rpa/rpaConfig.js`
- **Linhas 94-96**: URLs hardcoded como fallback
  - `base: process.env.TEST_BASE_URL || 'http://localhost:3000'`
  - `frontend: process.env.TEST_FRONTEND_URL || 'http://localhost:5173'`
  - `api: process.env.TEST_API_URL || 'http://localhost:3000'`
- **Problema**: Fallbacks hardcoded, mas já usa `rpa.config.json`
- **Solução sugerida**: Melhorar para usar `api/data/config.json` como fallback adicional

#### 11. `tests/rpa/overlayInjector.js`
- **Linha 1115**: `'http://localhost:3000'` (hardcoded)
- **Problema**: URL da API hardcoded
- **Solução sugerida**: Usar configuração

#### 12. `tests/rpa/test-overlay.js`
- **Linha 60**: `apiUrl: 'http://localhost:3000'` (hardcoded)
- **Problema**: URL da API hardcoded
- **Solução sugerida**: Usar configuração

#### 13. `tests/rpa/executar-teste-visivel.js`
- **Linhas 41, 69, 118, 130, 177**: `'http://localhost:5173'` (hardcoded)
- **Problema**: URL do frontend hardcoded em múltiplos lugares
- **Solução sugerida**: Usar configuração

#### 14. `tests/rpa/cli.js`
- **Linha 18**: `process.argv[4] || 'http://localhost:5173'`
- **Problema**: Fallback hardcoded
- **Solução sugerida**: Usar `rpa.config.json`

#### 15. `tests/rpa/gravar-seed-rpa.js`
- **Linha 30**: `const url = initialUrl || 'http://localhost:5173';`
- **Problema**: Fallback hardcoded
- **Solução sugerida**: Usar `rpa.config.json`

#### 16. `tests/rpa/examples/validacao-pagina-demo.js`
- **Linha 63**: `url: 'http://localhost:5173/support'`
- **Problema**: URL hardcoded em exemplo
- **Solução sugerida**: Usar configuração ou deixar como exemplo documentado

### Testes Unitários

#### 17. `tests/ai-governance/aiGovernance.test.js`
- **Linhas 127, 163, 198, 228**: `value: 'http://localhost:3000'`
- **Problema**: URLs hardcoded em testes
- **Solução sugerida**: Usar variáveis de ambiente ou mocks

## Estrutura do config.json Atual

O arquivo `api/data/config.json` atualmente possui:
- `api.port` - Porta da API
- `frontend.port` - Porta do frontend
- `frontend.apiBaseUrl` - URL base da API para o frontend

**Faltam**:
- `api.baseUrl` ou `api.url` - URL completa da API
- `frontend.url` - URL completa do frontend
- URLs para testes RPA

## Recomendações

### 1. Adicionar URLs ao config.json

Adicionar ao `api/data/config.json`:
```json
{
  "api": {
    "port": 3000,
    "baseUrl": "http://localhost:3000",
    ...
  },
  "frontend": {
    "port": 5173,
    "url": "http://localhost:5173",
    "apiBaseUrl": "http://localhost:3000",
    ...
  },
  "tests": {
    "rpa": {
      "frontendUrl": "http://localhost:5173",
      "apiUrl": "http://localhost:3000"
    }
  }
}
```

### 2. Criar utilitário para carregar URLs

Criar um utilitário que:
- Carrega URLs do `config.json`
- Tem fallback para variáveis de ambiente
- Tem fallback para valores padrão
- Funciona tanto no backend quanto no frontend (via API)

### 3. Prioridade de Correção

**Alta Prioridade** (afeta produção):
1. `frontend/src/api/client.js`
2. `frontend/src/hooks/useWebSocket.js`
3. `api/services/rpaService.js`

**Média Prioridade** (afeta desenvolvimento/testes):
4. `api/services/rpaTestGeneratorService.js`
5. `tests/rpa/rpaConfig.js`
6. `tests/rpa/utils/urlNormalizer.js`

**Baixa Prioridade** (exemplos/scripts):
7. Arquivos em `tests/rpa/examples/`
8. Scripts de teste manual

## Notas

- O arquivo `tests/rpa/rpa.config.json` já existe e é usado, mas não está integrado com `api/data/config.json`
- Muitos arquivos usam `process.env` como primeira opção, o que é bom, mas ainda têm fallbacks hardcoded
- O frontend usa `import.meta.env.VITE_API_BASE_URL`, que é correto, mas tem fallback hardcoded

