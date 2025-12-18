# Como Testar Localmente (Sem Deploy)

Este guia mostra como testar o projeto localmente em modo de desenvolvimento, sem precisar fazer build ou deploy.

## Pré-requisitos

- Node.js instalado (versão 20 ou superior)
- npm instalado

## Opção 1: Testar Apenas o Frontend (Mais Rápido)

Se você só quer testar a correção do erro `zs is not a constructor` no frontend:

```bash
# 1. Entre na pasta do frontend
cd frontend

# 2. Instale as dependências (se ainda não instalou)
npm install

# 3. Inicie o servidor de desenvolvimento
npm start
```

O Vite vai iniciar um servidor de desenvolvimento em `http://localhost:5173` (ou na porta configurada em `FRONTEND_PORT`).

**Nota**: O frontend vai tentar se conectar à API em `http://localhost:3000`. Se a API não estiver rodando, algumas funcionalidades não vão funcionar, mas você ainda pode testar se o erro foi corrigido.

## Opção 2: Testar Frontend + API (Completo)

Para testar tudo funcionando junto:

### Terminal 1 - API

```bash
# Na raiz do projeto
cd /opt/results/ria/r-agent2

# Configure variáveis de ambiente (opcional)
export API_PORT=3000
export DEFAULT_TENANT_ID=tenant-demo

# Inicie a API
node api/server.js
```

A API vai rodar em `http://localhost:3000`

### Terminal 2 - Frontend

```bash
# Entre na pasta do frontend
cd frontend

# Configure a URL da API (IMPORTANTE!)
# Opção 1: Criar arquivo .env.local
echo "VITE_API_BASE_URL=http://localhost:3000" > .env.local

# Opção 2: Ou exportar como variável de ambiente
export VITE_API_BASE_URL=http://localhost:3000

# Instale dependências (se necessário)
npm install

# Inicie o servidor de desenvolvimento
npm start
```

**IMPORTANTE**: Se você não configurar `VITE_API_BASE_URL`, o frontend tentará fazer requisições para URLs relativas (ex: `/flows`), o que resultará em erro 404. Configure sempre a URL da API!

O frontend vai rodar em `http://localhost:5173` (ou na porta configurada)

## Verificar se o Erro Foi Corrigido

1. Abra o navegador em `http://localhost:5173`
2. Abra o Console do Desenvolvedor (F12)
3. Verifique se o erro `zs is not a constructor` ainda aparece
4. Tente criar um fluxo ou carregar um existente

## Vantagens do Modo de Desenvolvimento

- **Hot Reload**: Mudanças no código são refletidas automaticamente
- **Sem Build**: Não precisa fazer `npm run build` toda vez
- **Debugging**: Erros aparecem com mais detalhes no console
- **Rápido**: Inicia muito mais rápido que um build completo

## Solução de Problemas

### Erro: "Cannot find module"
```bash
# Instale as dependências
cd frontend
npm install
```

### Erro: "Port already in use"
```bash
# Use uma porta diferente
export FRONTEND_PORT=5174
npm start
```

### Frontend não conecta à API (Erro 404)

**Sintoma**: Erro `HTTP Error 404 ao chamar /flows` nos logs

**Solução**:
1. Verifique se a API está rodando:
   ```bash
   curl http://localhost:3000/health
   ```
   Deve retornar `{"status":"ok"}`

2. Configure `VITE_API_BASE_URL`:
   ```bash
   # Na pasta frontend, crie .env.local
   echo "VITE_API_BASE_URL=http://localhost:3000" > .env.local
   ```
   
   Ou exporte como variável:
   ```bash
   export VITE_API_BASE_URL=http://localhost:3000
   ```

3. Reinicie o servidor do Vite (pare com Ctrl+C e inicie novamente)

4. Verifique os logs - deve aparecer um aviso se a URL não estiver configurada

## Parar os Servidores

- No terminal, pressione `Ctrl+C` para parar o servidor
- Ou feche o terminal

