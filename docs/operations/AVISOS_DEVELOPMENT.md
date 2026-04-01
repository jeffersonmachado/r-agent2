# Avisos e Problemas Identificados no Ambiente de Desenvolvimento

## 📋 Resumo dos Avisos

### ✅ Sistema Funcionando
O sistema está rodando corretamente, mas há alguns avisos que podem ser corrigidos:

### ⚠️ Avisos Encontrados

#### 1. Versão do Node.js
**Problema:** Node.js 20.18.1 está instalado, mas Vite requer 20.19+ ou 22.12+

**Status:** ⚠️ Aviso (não crítico - sistema funciona, mas pode haver problemas futuros)

**Solução:**
```bash
# Usando nvm (recomendado)
nvm install 22.12.0
nvm use 22.12.0

# Ou atualizar para Node.js 22 LTS
nvm install --lts
nvm use --lts
```

**Arquivo criado:** `.nvmrc` especifica a versão recomendada (22.12.0)

#### 2. Redis Não Configurado
**Problema:** URL do Redis não configurada para rate limiting

**Status:** ⚠️ Aviso (funcional em desenvolvimento, mas rate limiting não funcionará)

**Solução:**
- Configure `rateLimit.redis.url` em `api/data/config.json`
- Ou defina a variável de ambiente `RATE_LIMIT_REDIS_URL` ou `REDIS_URL`

#### 3. OpenAI e Anthropic Não Configurados
**Problema:** Chaves de API não configuradas

**Status:** ⚠️ Aviso (sistema usa fallback, mas funcionalidades de IA não funcionarão)

**Solução:**
- Configure as chaves de API em `api/data/config.json` ou variáveis de ambiente
- `OPENAI_API_KEY` para OpenAI
- `ANTHROPIC_API_KEY` para Anthropic

#### 4. Docker Daemon Não Está Rodando
**Problema:** Erros ao tentar conectar ao Docker daemon

**Status:** ℹ️ Informativo (não crítico se não estiver usando Docker)

**Solução:**
```bash
# Iniciar Docker daemon (se necessário)
sudo systemctl start docker
```

#### 5. RAG Service Iniciado mas Não Respondendo
**Problema:** RAG Service iniciado mas ainda não está respondendo no primeiro check

**Status:** ℹ️ Informativo (normal durante inicialização)

**Solução:**
- Aguarde alguns segundos após iniciar
- Verifique os logs: `tail -f /tmp/rag-service-dev.log`
- O serviço geralmente fica pronto após alguns segundos

## 🚀 Serviços em Execução

- ✅ **API:** http://localhost:3000
- ✅ **Frontend:** http://localhost:5173
- ✅ **RAG Service:** http://localhost:8000

## 📝 Próximos Passos Recomendados

1. **Atualizar Node.js** para versão 22.12.0 ou superior
2. **Configurar Redis** se precisar de rate limiting
3. **Configurar chaves de API** se precisar de funcionalidades de IA
4. **Iniciar Docker** se precisar usar containers

## 🔧 Comandos Úteis

```bash
# Verificar versão do Node.js
node --version

# Usar versão especificada no .nvmrc
nvm use

# Verificar status dos serviços
npm run services:status

# Ver logs do RAG Service
npm run rag:logs
# ou
tail -f /tmp/rag-service-dev.log
```
