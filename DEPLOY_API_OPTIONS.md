# Deploy da API - Opções de Velocidade

Criei 4 versões do deploy de API com diferentes trade-offs de velocidade vs. escopo de mudanças.

## Comparação Rápida

| Comando | Tempo | Escopo | Use Quando |
|---------|-------|--------|-----------|
| `npm run deploy:remote:ssh:api` | 15-20 min | Rebuild completo (API + dependências todas) | Deploy de produção, mudanças maiores |
| `npm run deploy:remote:ssh:api:quickbuild` | 3-8 min | Rebuild apenas da API (Dockerfile.base + Dockerfile) | Mudou dependências ou configs de runtime |
| `npm run deploy:remote:ssh:api:hotpatch` | 2-5 min | Cópia + npm ci no container (sem rebuild) | Mudou dependências (package.json) |
| `npm run deploy:remote:ssh:api:copy` | ~30 seg | Cópia apenas de código (api/app, api/routes, etc) | **MAIS RÁPIDO** - hotfix de código JS puro |

## Detalhes de Cada Opção

### 1. Full Deploy (Padrão) - `deploy:remote:ssh:api`
```bash
npm run deploy:remote:ssh:api
# Tempo: 15-20 minutos
```

**O que faz:**
- Sincroniza TUDO (api/, frontend/, rag-service/, etc)
- Rebuild de TODAS as imagens (frontend, api, rag-service, redis)
- Up completo do docker-compose.prod.yml

**Use quando:**
- Deploy de produção oficial
- Mudanças em múltiplos serviços
- Setup inicial

---

### 2. Quick Build (Recomendado para mudanças de código + deps) - `deploy:remote:ssh:api:quickbuild`
```bash
npm run deploy:remote:ssh:api:quickbuild
# Tempo: 3-8 minutos
```

**O que faz:**
- Sincroniza: `api/`, `config/`, `contracts/`, `lib/`, `package*.json`
- Rebuild **apenas** da imagem da API
- Container API é atualizado com a nova imagem
- Outros serviços (frontend, rag-service, redis) não são tocados

**Use quando:**
- Mudou arquivo `package.json` (adicionou/removeu dependências)
- Mudou código da API que precisa recompilar
- Quer rebuild isolado (mais seguro que hotpatch)

**Exemplo:**
```bash
# Adicionar dependência:
# npm i axios
# Depois sincronizar:
npm run deploy:remote:ssh:api:quickbuild
```

---

### 3. Hotpatch (Rápido, sem rebuild) - `deploy:remote:ssh:api:hotpatch`
```bash
npm run deploy:remote:ssh:api:hotpatch
# Tempo: 2-5 minutos
```

**O que faz:**
- Sincroniza: `api/`, `config/`, `contracts/`, `lib/`, `package*.json`
- Roda `npm ci --omit=dev` **DENTRO DO CONTAINER** existente
- Não faz rebuild de imagem Docker
- Reinicia apenas o container da API

**Use quando:**
- Mudou `package.json` e quer instalar deps rapidamente
- Quer evitar longa espera de rebuild de Docker
- Container já tem a imagem correcta, só precisa de npm install

**Importante:**
- Reusa a imagem Docker existente
- Não toca em node_modules pré-compilados se não precisar
- Mais arriscado que rebuild (pode deixar artifacts estranhos)

**Exemplo:**
```bash
# Cenário: Adicionou asyncio, quer testar rápido
npm run deploy:remote:ssh:api:hotpatch
```

---

### 4. Copy (MAIS RÁPIDO - código puro) - `deploy:remote:ssh:api:copy`
```bash
npm run deploy:remote:ssh:api:copy
# Tempo: ~30 segundos
```

**O que faz:**
- Sincroniza: **apenas** `api/app/`, `api/routes/`, `api/services/`, etc (código-fonte)
- **Não sincroniza** `package.json`, `Dockerfile`, `node_modules`
- Reutiliza imagem Docker e node_modules existentes
- Reinicia container (força reload de código)

**Use quando:**
- Bug fix rápido em código JavaScript
- Mudou lógica de rota/middleware/service
- Não mudou dependências ou configuração de build

**⚠️ Importante:**
- Presume que `node_modules` já está correto no container
- Se mudou `package.json`, use `hotpatch` ou `quickbuild` em vez disto
- Se mudou Dockerfile ou configs, use `quickbuild`

**Exemplo:**
```bash
# Cenário: Bug em /api/routes/supportRoutes.js
# 1. Fix o código localmente
vim api/routes/supportRoutes.js
# 2. Deploy rápido
npm run deploy:remote:ssh:api:copy
# 3. Testa mudança em 30 segundos
```

---

## Matriz de Decisão

```
Mudou package.json?
├─ SIM → Use :quickbuild ou :hotpatch
│       (hotpatch = mais rápido, quickbuild = mais seguro)
└─ NÃO 
    └─ Mudou Dockerfile ou config de build?
      ├─ SIM → Use :quickbuild
      └─ NÃO
          └─ Mudou apenas código JavaScript?
            ├─ SIM → Use :copy (MAIS RÁPIDO!)
            └─ NÃO → Use :hotpatch (fallback seguro)
```

---

## Workflow Recomendado

### Para Development/Testing:
```bash
# 1. Hotfix de código (rápido):
npm run deploy:remote:ssh:api:copy

# 2. Se testou e quer build mais confiável:
npm run deploy:remote:ssh:api:quickbuild

# 3. Para deploy final:
npm run deploy:remote:ssh:api
```

### Para Production Deploy:
```bash
# Deploy completo (sempre o mais seguro):
npm run deploy:remote:ssh:api
```

### Para Emergency Hotfix:
```bash
# Opção 1: Mais rápido (assumindo node_modules OK):
npm run deploy:remote:ssh:api:copy

# Opção 2: Mais seguro (refaz deps):
npm run deploy:remote:ssh:api:hotpatch
```

---

## Troubleshooting

### "Container não está em execução"
- Certifique-se de que o stack está up: `docker-compose -f docker-compose.prod.yml ps`
- Se não, inicie: `npm run deploy:up`

### "npm ci falhou no hotpatch"
- Tente `quickbuild` em vez (faz rebuild, mais confiável)
- Ou verifique `docker logs r-agent2-api`

### "Código não mudou após deploy"
- Se usou `:copy`, verifique se mudou `package.json` (use `:hotpatch`)
- Verifique logs: `docker logs -f r-agent2-api`
- Pode ser que a API faça cache - force restart do cliente

### "Build ficou pendurado/timeout"
- Scripts ssh têm timeout de ~10 minutos
- Se build > 10 min, precisa reexecutar manualmente no servidor

---

## Customização

Todos os scripts aceitam:
```bash
npm run deploy:remote:ssh:api:copy -- --host 10.10.2.30 --user root --password senha
```

Variáveis de ambiente (alternativa):
```bash
DEPLOY_HOST=10.10.2.30 DEPLOY_USER=root SSH_PASSWORD=senha npm run deploy:remote:ssh:api:copy
```

---

## Notas Técnicas

- **:copy** → Sincronização rsync (eficiente, delta-sync)
- **:hotpatch** → npm ci no container (reutiliza imagem)
- **:quickbuild** → docker build apenas API (sem cache, mais seguro)
- **:api** (completo) → docker build tudo + up completo

Todos reexecutam testes de healthcheck e aguardam container estar Up antes de retornar.
