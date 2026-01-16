## Deploy do Chatbot Builder (Visão Geral)

Este documento descreve como empacotar e subir o produto usando **Docker Compose**, com variáveis de ambiente por ambiente.

Arquivos principais:

- `docker-compose.yml` – orquestração de serviços.
- `api/Dockerfile` – imagem mínima da API (placeholder).
- `frontend/Dockerfile` – imagem do frontend (builder visual) via Vite + Nginx.
- `env.example` – exemplo de variáveis de ambiente.

> Importante: a API atual expõe apenas endpoints básicos (`/health`, `/version`). Os endpoints reais de fluxo/conversa podem ser adicionados depois, reutilizando a mesma estrutura de deploy.

---

## Estrutura dos serviços (docker-compose.yml)

- **api**
  - Build: contexto raiz, `api/Dockerfile`.
  - Porta interna: `3000`.
  - Porta externa: configurável via `API_PORT` (default `3000`).
  - Variáveis:
    - `NODE_ENV` – ambiente (`production`, `staging`, `development`).
    - `API_PORT` – porta interna de escuta.

- **frontend**
  - Build: `frontend/Dockerfile`.
  - Servido por `nginx` em `80` dentro do container.
  - Porta externa: configurável via `FRONTEND_PORT` (default `8080`).
  - Variáveis:
    - `NODE_ENV` – ambiente de build.
    - `VITE_API_BASE_URL` – URL base da API usada pelo frontend.

---

## Variáveis de ambiente

Use o arquivo `env.example` como base:

```bash
cp env.example .env
```

Edite `.env` conforme o ambiente:

- **Produção**
  - `NODE_ENV=production`
  - `API_PORT=3000`
  - `FRONTEND_PORT=80` (se exposto diretamente)
  - `VITE_API_BASE_URL=https://sua-api.exemplo.com`

- **Staging**
  - `NODE_ENV=production`
  - `API_PORT=4000`
  - `FRONTEND_PORT=8081`
  - `VITE_API_BASE_URL=https://sua-api-staging.exemplo.com`

- **Desenvolvimento local**
  - `NODE_ENV=development`
  - `API_PORT=3000`
  - `FRONTEND_PORT=8080`
  - `VITE_API_BASE_URL=http://localhost:3000`

> Observação: se estiver usando multi-tenant e múltiplos providers de IA, variáveis adicionais podem ser definidas (ex.: `AI_PROVIDER_PRIMARY`, `AI_PROVIDER_FALLBACK`) e consumidas pela camada de backend.

---

## Build e subir ambiente com Docker Compose

1. **Copiar variáveis de exemplo**

```bash
cp env.example .env
```

2. **Build das imagens**

```bash
docker compose --env-file .env build
```

3. **Subir os serviços**

```bash
docker compose --env-file .env up -d
```

4. **Verificar serviços**

- API: `GET http://localhost:${API_PORT}/health`
- Frontend: `http://localhost:${FRONTEND_PORT}`

---

## Estratégia de deploy

### 1. Deploy simples (single host)

- Usar `docker compose` diretamente em um VM/servidor.
- Configurar `.env` para cada ambiente (prod, staging, etc.).
- Integrar com um reverse proxy (nginx/traefik) se necessário para:
  - TLS/HTTPS.
  - Domínios amigáveis (ex.: `app.seudominio.com`, `api.seudominio.com`).

### 2. CI/CD

Passos típicos de pipeline:

1. **Build e testes**
   - `npm test` na raiz (`chatbot-engine`).
   - Build do frontend (por exemplo, `npm run build` dentro de `frontend/`).
2. **Build de imagens**
   - `docker build -t sua-registry/chatbot-api -f api/Dockerfile .`
   - `docker build -t sua-registry/chatbot-frontend -f frontend/Dockerfile ./frontend`
3. **Push das imagens** para uma registry (Docker Hub, ECR, GCR, etc.).
4. **Deploy** com `docker compose` ou orquestrador (Kubernetes, ECS, etc.) usando essas imagens.

---

## Multi-tenant e segurança

- Em cenários multi-tenant reais, o `tenantId` deve ser extraído do token/autenticação ou fornecido via header `X-Tenant-Id`.
- O isolamento por tenant é garantido na engine (tipos/estado trazem `tenantId`), mas o **deploy** deve garantir:
  - Que logs/audit estejam segregados por tenant quando necessário.
  - Que segredos (chaves de IA, credenciais de banco) sejam definidos por ambiente e, se preciso, por tenant (via cofres de segredos externos).

---

## Endpoints da API

A API expõe os seguintes endpoints:

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/health` | Status de saúde da API |
| `GET` | `/version` | Informações de versão |
| `GET` | `/flows` | Lista todos os fluxos |
| `GET` | `/flows/:id` | Busca um fluxo específico |
| `POST` | `/flows` | Cria um novo fluxo |
| `PUT` | `/flows/:id` | Atualiza um fluxo existente |
| `POST` | `/flows/validate` | Valida um fluxo |
| `POST` | `/flows/simulate` | Simula a execução de um fluxo |
| `GET` | `/replay/:sessionId` | Carrega replay de uma sessão |

### Exemplos de uso

#### Validar um fluxo

```bash
curl -X POST http://localhost:3000/flows/validate \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-demo",
    "id": "flow-1",
    "name": "Meu Fluxo",
    "version": 1,
    "nodes": [
      {
        "id": "start-1",
        "type": "start",
        "next": "msg-1"
      },
      {
        "id": "msg-1",
        "type": "message",
        "config": { "text": "Olá!" },
        "next": null
      }
    ]
  }'
```

Resposta esperada:
```json
{
  "valid": true,
  "errors": []
}
```

#### Simular um fluxo

```bash
curl -X POST http://localhost:3000/flows/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "flowId": "flow-1",
    "maxSteps": 10,
    "startNodeId": "start-1"
  }'
```

Resposta esperada:
```json
{
  "compiledFlowInfo": {
    "id": "flow-1",
    "version": 1,
    "versionHash": "..."
  },
  "steps": [...],
  "events": [...],
  "replay": {
    "sessionId": "...",
    "flowId": "flow-1",
    "messages": [...],
    "handoffs": [],
    "nodesVisited": [...],
    "rawEvents": [...]
  }
}
```

> **Nota**: Para usar com `VITE_API_BASE_URL=http://localhost:3000`, o frontend já está configurado para chamar esses endpoints automaticamente.

---

## Próximos passos

- Refinar variáveis de ambiente específicas de AI providers (por tenant) e de storage (bancos/filas) conforme a infraestrutura escolhida.
- Adicionar persistência de fluxos (substituir storage em memória por banco de dados).
- Implementar autenticação/autorização para endpoints sensíveis.


