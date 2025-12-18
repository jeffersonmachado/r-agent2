# Configuração da API para Desenvolvimento Local

## Problema: Erro 404 ao criar fluxo

Se você está vendo o erro `HTTP Error 404 ao chamar /flows`, significa que a URL base da API não está configurada.

## Solução Rápida

### Opção 1: Criar arquivo `.env.local` (Recomendado)

Na pasta `frontend`, crie um arquivo chamado `.env.local` com:

```bash
VITE_API_BASE_URL=http://localhost:3000
```

**Importante**: Reinicie o servidor do Vite após criar o arquivo!

### Opção 2: Variável de ambiente

```bash
export VITE_API_BASE_URL=http://localhost:3000
npm start
```

## Verificação

1. Certifique-se de que a API está rodando:
   ```bash
   curl http://localhost:3000/health
   ```
   Deve retornar: `{"status":"ok"}`

2. Verifique os logs do frontend - deve aparecer um aviso se a URL não estiver configurada

3. Tente criar um fluxo novamente

## Quando usar cada configuração

- **Desenvolvimento local**: `VITE_API_BASE_URL=http://localhost:3000`
- **Docker Compose**: Deixe vazio (usa proxy nginx)
- **Produção**: Configure conforme seu ambiente

## Arquivo .env.local

Crie o arquivo na pasta `frontend/.env.local`:

```env
# URL base da API
VITE_API_BASE_URL=http://localhost:3000

# Nível de log (opcional)
# VITE_LOG_LEVEL=0
```

**Nota**: O arquivo `.env.local` não deve ser commitado no git (já está no .gitignore).

