# Configuração de Token RPA

Este diretório contém a configuração do token exclusivo para automação RPA.

## Arquivo: `rpa-token.json`

Este arquivo armazena o token exclusivo usado para autenticação RPA. **Este arquivo NÃO deve ser commitado no repositório** por questões de segurança.

### Geração do Token

O token RPA é gerado automaticamente na primeira execução ou pode ser obtido via API:

```bash
# Via API
curl http://localhost:3000/auth/rpa/token

# Via código (gerado automaticamente se não existir)
node -e "const { getOrCreateRpaToken } = require('./tests/rpa/utils/rpaTokenManager'); console.log(getOrCreateRpaToken());"
```

### Uso do Token

O token RPA é usado automaticamente pelo sistema de automação para:

1. **Autenticação via API**: `POST /auth/rpa/login` com `{ "token": "<rpa-token>" }`
2. **Login automático em testes RPA**: O `authHelper` usa o token para fazer login antes de executar testes
3. **Replay de gravações**: Todas as execuções RPA usam este token para autenticação

### Variável de Ambiente

Alternativamente, você pode definir o token via variável de ambiente:

```bash
export RPA_TOKEN="seu-token-aqui"
```

A variável de ambiente tem prioridade sobre o arquivo de configuração.

### Segurança

- ⚠️ **NUNCA** commite o arquivo `rpa-token.json` no repositório
- ⚠️ Mantenha o token seguro e não o compartilhe publicamente
- ⚠️ O token dá acesso completo ao sistema como agente RPA (role: admin)
- ⚠️ Regenerar o token invalida todos os testes RPA em execução

### Estrutura do Arquivo

```json
{
  "token": "hexadecimal-token-64-chars",
  "description": "Token exclusivo para automação RPA. Gere um token único e seguro.",
  "generatedAt": "2025-01-03T12:00:00.000Z",
  "expiresAt": null,
  "note": "Este arquivo deve ser mantido seguro e não deve ser commitado no repositório."
}
```

### Expiração

Por padrão, o token não expira (`expiresAt: null`). Se necessário, você pode configurar expiração ao gerar o token:

```javascript
const { generateAndSaveRpaToken } = require('./tests/rpa/utils/rpaTokenManager');
generateAndSaveRpaToken({ expiresInDays: 30 }); // Expira em 30 dias
```

