# Script de Reset Completo

Script para resetar completamente a plataforma r-agent2, limpando:
- ✅ Containers Docker (desenvolvimento e produção)
- ✅ Volumes Docker
- ✅ Serviços systemd (Redis, RAG)
- ✅ Processos (uvicorn, Node.js)
- ✅ Cache Redis
- ✅ Dados JSON (reset com seed)

## Uso

### Via npm (recomendado)
```bash
# Com confirmação interativa
npm run reset:all

# Sem confirmação (automático)
npm run reset:all:yes
```

### Diretamente
```bash
# Com confirmação
./scripts/reset-all.sh

# Com tenant específico
./scripts/reset-all.sh tenant-ecommerce

# Sem confirmação
./scripts/reset-all.sh <tenant-id> --yes
```

## Parâmetros

1. **Tenant ID** (obrigatório)
   - Ex.: `tenant-acme`
   - `tenant-ecommerce` - E-commerce Store
   - `tenant-saude` - Clínica de Saúde

2. **Confirmação** (opcional)
   - `--yes` ou `-y` - Pula confirmação interativa

## O que é limpo

### Docker
- Containers do `docker-compose.yml` (desenvolvimento)
- Containers do `docker-compose.prod.yml` (produção)
- Todos os volumes Docker
- Containers órfãos

### Serviços
- Serviço RAG (systemd)
- Serviço Redis (systemd)
- Processos uvicorn
- Processos Node.js da API

### Dados
- Cache Redis (FLUSHALL)
- Dados JSON resetados via seed

## Após o reset

Para reiniciar a plataforma:

### Desenvolvimento
```bash
docker-compose up -d
```

### Produção
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Serviços systemd
```bash
npm run services:start
```

## Exemplos

### Reset completo padrão
```bash
npm run reset:all
```

### Reset para tenant específico
```bash
./scripts/reset-all.sh tenant-ecommerce
```

### Reset automático (sem confirmação)
```bash
npm run reset:all:yes
```

## ⚠️ Atenção

Este script **remove TODOS os dados**:
- Containers Docker
- Volumes Docker (incluindo dados persistentes)
- Cache Redis
- Dados JSON (serão recriados com seed)

**Use com cuidado em produção!**

## Credenciais após reset

Após o reset, as credenciais padrão são:

- **Admin**: `admin` / `Admin123!`
- **Supervisor**: `supervisor` / `supervisor123`
- **Atendente**: `atendente1` ou `atendente2` / `atendente123`
