# Como Iniciar os Serviços

Este guia explica como iniciar todos os serviços necessários para o sistema funcionar corretamente.

## 🚀 Início Rápido

### Opção 1: Script Automático (Recomendado)

```bash
# Inicia todos os serviços automaticamente
./scripts/start-dev.sh
```

Este script:
- ✅ Verifica se os serviços já estão rodando
- ✅ Inicia o servidor Node.js (porta 3000)
- ✅ Inicia o serviço RAG Python (porta 9000)
- ✅ Inicia o frontend (porta 5173)

### Opção 2: Manual (Terminais Separados)

#### Terminal 1: Serviço RAG (Python)
```bash
cd rag-service
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 9000
```

**Verificar se está rodando:**
```bash
curl http://localhost:9000/rag/health
```

#### Terminal 2: API Node.js
```bash
# Na raiz do projeto
node api/server.js
```

**Verificar se está rodando:**
```bash
curl http://localhost:3000/health
```

#### Terminal 3: Frontend
```bash
cd frontend
npm start
```

**Acessar:** http://localhost:5173

## 📋 Verificação de Serviços

### Verificar Status dos Serviços

```bash
# Verificar RAG Service
curl http://localhost:9000/rag/health

# Verificar API Node.js
curl http://localhost:3000/health

# Verificar Frontend (deve estar acessível no navegador)
curl http://localhost:5173
```

### Verificar Portas em Uso

```bash
# Verificar porta 9000 (RAG Service)
lsof -i :9000

# Verificar porta 3000 (API Node.js)
lsof -i :3000

# Verificar porta 5173 (Frontend)
lsof -i :5173
```

## 🔧 Troubleshooting

### Erro: "CONNECTION_REFUSED" no RAG

**Causa:** Serviço RAG não está rodando na porta 9000.

**Solução:**
```bash
cd rag-service
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 9000
```

### Erro: "API não acessível" no Frontend

**Causa:** API Node.js não está rodando na porta 3000.

**Solução:**
```bash
node api/server.js
```

### Erro: "ModuleNotFoundError: No module named 'pytest'"

**Causa:** Dependências Python não instaladas.

**Solução:**
```bash
cd rag-service
pip3 install -r requirements.txt
```

### Erro: Porta já em uso

**Solução:**
```bash
# Encontrar processo usando a porta
lsof -i :9000  # ou :3000, :5173

# Matar processo (substitua PID pelo número do processo)
kill -9 <PID>
```

## 📝 Configuração

### Portas Padrão

- **RAG Service:** 9000 (configurável em `api/data/config.json` → `rag.service.port`)
- **API Node.js:** 3000 (configurável em `api/data/config.json` → `api.port`)
- **Frontend:** 5173 (configurável em `frontend/vite.config.js`)

### Variáveis de Ambiente

O RAG Service pode ser configurado via variáveis de ambiente ou `config.json`:

```bash
# Exemplo de .env no rag-service/
RAG_HOST=0.0.0.0
RAG_PORT=9000
RAG_DEBUG=true
```

## ✅ Checklist de Inicialização

Antes de usar o sistema, verifique:

- [ ] RAG Service está rodando (porta 9000)
- [ ] API Node.js está rodando (porta 3000)
- [ ] Frontend está rodando (porta 5173)
- [ ] Redis está rodando (se necessário)
- [ ] Variáveis de ambiente configuradas (se necessário)

## 🧪 Testar Serviços

Após iniciar os serviços, execute os testes:

```bash
# Testes de aprendizado adaptativo
npm run test:rag:adaptive

# Todos os testes
npm run test:complete
```

## 📚 Documentação Relacionada

- [RAG para Desenvolvimento](./RAG_PARA_DEV.md)
- [Como Testar RAG](./COMO_TESTAR_RAG.md)
- [Configuração de IA](./CONFIGURACAO_IA.md)

