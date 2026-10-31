# Clean checkout — bootstrap-twice

- commit: `3f6c30d0cd380e16ed0357d1c7648b1bb6f46337`
- branch: `dev/engineering-hardening`
- sourceFingerprint: `2d9bc644d04da40d5692347c5238d083042a217048df9ebc1c849815707b87fe`
- runId: `clean-checkout-20261022073118269-d66fe5`
- environmentId: `local-jmachado-Precision-5530-588286`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap-1 | 0 | 0 | 94s | PASS |
| bootstrap-2 | 0 | 0 | 77s | PASS |
| idempotencia-seed | igual | 0 | 0s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:38159 redis:35771
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em 127.0.0.1:35177 (nao usa o 8001 do desenvolvedor)
