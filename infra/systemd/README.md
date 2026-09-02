# systemd — overrides versionados

## r-agent2-rag.service

O unit base (`/etc/systemd/system/r-agent2-rag.service`) binda `:8000`, que
colide com o container Docker do rag-service no modelo oficial de produção
(`docker-compose.prod.yml` publica `"8000"`). O unit morre com
`Errno 98 (address already in use)`.

No modelo host (dev/stack local fora do Docker), a porta canônica do RAG é
**8001** — é o default de `rag.serviceUrl` consumido pela API
(`api/services/rag/ragRuntime.js`).

### Aplicar o override (requer sudo)

```bash
sudo mkdir -p /etc/systemd/system/r-agent2-rag.service.d
sudo cp infra/systemd/r-agent2-rag.service.d/override.conf \
  /etc/systemd/system/r-agent2-rag.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart r-agent2-rag
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8001/health   # esperado: 200
```

### Regras de coexistência

- **Produção (Docker Compose):** o rag-service roda no container (`:8000`
  publicado). O unit systemd **não** deve estar enabled — ou deve usar este
  override para não disputar a porta.
- **Dev/stack host:** o rag-service roda via systemd (ou `npm run rag:dev`)
  em `:8001`. Nunca bindar `:8000` no host enquanto o compose estiver de pé.

Enquanto o override não é aplicado, o workaround usado nas sessões de
desenvolvimento é subir o serviço manualmente:

```bash
cd rag-service && nohup ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 \
  --env-file .env > ../logs/rag-service-dev.log 2>&1 &
```
