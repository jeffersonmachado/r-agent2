# Correções Aplicadas: URLs Hardcoded

## Resumo

Todas as URLs hardcoded foram corrigidas para usar o arquivo `api/data/config.json` como fonte de configuração principal, com fallback para variáveis de ambiente e valores padrão.

## Arquivos Corrigidos

### 1. Configuração Base
- ✅ `api/data/config.json` - Adicionadas URLs completas:
  - `api.baseUrl`: URL completa da API
  - `frontend.url`: URL completa do frontend
  - `frontend.apiBaseUrl`: URL da API para o frontend
  - `tests.rpa.frontendUrl`: URL do frontend para testes RPA
  - `tests.rpa.apiUrl`: URL da API para testes RPA

- ✅ `api/data/config.example.json` - Atualizado com as mesmas URLs

### 2. Backend/Services
- ✅ `api/services/rpaTestGeneratorService.js`
  - Agora usa `config.get('tests.rpa.frontendUrl')` ou `config.get('frontend.url')`
  - Prioridade: TEST_FRONTEND_URL > FRONTEND_URL > config.json > fallback

- ✅ `api/services/rpaService.js`
  - Agora usa `config.get('api.baseUrl')` ou `config.get('scripts.apiUrl')`
  - Prioridade: API_BASE_URL > config.json > fallback

- ✅ `engine/ai/generateRpaTest.js`
  - Agora usa `config.get('api.baseUrl')` ou `config.get('frontend.apiBaseUrl')`
  - Fallback para 'http://localhost:3000'

### 3. Frontend
- ✅ `frontend/src/api/client.js`
  - Documentação melhorada indicando que deve corresponder a `config.json > frontend.apiBaseUrl`
  - Mantém uso de `VITE_API_BASE_URL` (variável de ambiente) como prioridade
  - Comentários atualizados explicando a relação com config.json

- ✅ `frontend/src/hooks/useWebSocket.js`
  - Documentação melhorada indicando que deve corresponder a `config.json > frontend.apiBaseUrl`
  - Mantém uso de `VITE_API_BASE_URL` (variável de ambiente) como prioridade

**Nota sobre Frontend**: O frontend não pode acessar diretamente `api/data/config.json` em tempo de execução. A configuração deve ser fornecida via:
- Variável de ambiente `VITE_API_BASE_URL` (recomendado)
- Endpoint `/config` da API (se implementado)

### 4. Testes RPA
- ✅ `tests/rpa/rpaConfig.js`
  - Agora usa `mainConfig.get('tests.rpa.*')` ou `mainConfig.get('api.baseUrl')` como fallback adicional
  - Prioridade: TEST_*_URL > rpa.config.json > config.json > fallback

- ✅ `tests/rpa/utils/urlNormalizer.js`
  - Agora usa `config.get('tests.rpa.frontendUrl')` ou `config.get('frontend.url')`
  - Prioridade: TEST_FRONTEND_URL > FRONTEND_URL > config.json > fallback

- ✅ `tests/rpa/rpaTestRunner.js`
  - Agora usa `config.urls.frontend` do rpaConfig.js

- ✅ `tests/rpa/player/rpaPlayer.js`
  - Agora usa `require('./rpaConfig').urls.frontend`

- ✅ `tests/rpa/utils/authHelper.js`
  - Agora usa `rpaConfig.urls.api` ou `mainConfig.get('tests.rpa.apiUrl')`
  - Prioridade: options.apiBaseUrl > TEST_API_URL > API_BASE_URL > rpa.config.json > config.json > fallback

- ✅ `tests/rpa/overlayInjector.js`
  - Agora usa `rpaConfig.urls.api` para teste manual

- ✅ `tests/rpa/test-overlay.js`
  - Agora usa `rpaConfig.urls.api`

- ✅ `tests/rpa/cli.js`
  - Agora usa `rpaConfig.urls.frontend`

- ✅ `tests/rpa/gravar-seed-rpa.js`
  - Agora usa `rpaConfig.urls.frontend`

- ✅ `tests/rpa/executar-teste-visivel.js`
  - Agora usa `rpaConfig.urls.frontend` em todos os lugares

- ✅ `tests/rpa/examples/validacao-pagina-demo.js`
  - Agora usa `rpaConfig.urls.frontend`

### 5. Testes Unitários
- ✅ `tests/ai-governance/aiGovernance.test.js`
  - Agora usa `process.env.TEST_API_URL` ou `process.env.API_BASE_URL`
  - Fallback para 'http://localhost:3000'

## Hierarquia de Configuração

A ordem de prioridade para obter URLs é:

1. **Variáveis de Ambiente** (maior prioridade)
   - `TEST_FRONTEND_URL`, `TEST_API_URL`, `TEST_BASE_URL`
   - `FRONTEND_URL`, `API_BASE_URL`
   - `VITE_API_BASE_URL` (apenas frontend)

2. **Arquivos de Configuração**
   - `tests/rpa/rpa.config.json` (para testes RPA)
   - `api/data/config.json` (configuração principal)

3. **Valores Padrão** (fallback final)
   - `http://localhost:3000` (API)
   - `http://localhost:5173` (Frontend)

## Como Configurar

### Desenvolvimento Local
Edite `api/data/config.json`:
```json
{
  "api": {
    "baseUrl": "http://localhost:3000"
  },
  "frontend": {
    "url": "http://localhost:5173",
    "apiBaseUrl": "http://localhost:3000"
  },
  "tests": {
    "rpa": {
      "frontendUrl": "http://localhost:5173",
      "apiUrl": "http://localhost:3000"
    }
  }
}
```

### Produção
Use variáveis de ambiente ou edite `config.json`:
```json
{
  "api": {
    "baseUrl": "https://api.seudominio.com"
  },
  "frontend": {
    "url": "https://app.seudominio.com",
    "apiBaseUrl": "https://api.seudominio.com"
  }
}
```

### Frontend
Configure `VITE_API_BASE_URL` no `.env.local`:
```bash
VITE_API_BASE_URL=https://api.seudominio.com
```

## Verificação

Para verificar se todas as correções foram aplicadas:
```bash
# Buscar URLs hardcoded restantes (não deve encontrar muitas)
grep -r "http://localhost:3000" --include="*.js" --exclude-dir=node_modules | grep -v "fallback\|padrão\|default\|example"
grep -r "http://localhost:5173" --include="*.js" --exclude-dir=node_modules | grep -v "fallback\|padrão\|default\|example"
```

## Notas Importantes

1. **Frontend**: O frontend não pode acessar `config.json` diretamente. Use `VITE_API_BASE_URL` ou implemente um endpoint `/config` na API.

2. **Testes RPA**: Os testes RPA usam `rpa.config.json` como primeira fonte, mas agora também consultam `api/data/config.json` como fallback.

3. **Compatibilidade**: Todas as correções mantêm compatibilidade com variáveis de ambiente existentes.

4. **Arquivos de Exemplo**: Arquivos em `tests/rpa/examples/` foram corrigidos, mas são apenas exemplos e podem ser atualizados conforme necessário.

