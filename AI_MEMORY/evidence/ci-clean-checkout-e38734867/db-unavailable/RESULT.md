# Clean checkout — db-unavailable

- commit: `e38734867db9697443a72214b4150c23ffda65eb`
- branch: `dev/engineering-hardening`
- sourceFingerprint: `11de55de75685675e1c971c163040a7effef196fbb3b70da1848d907da7a3a58`
- runId: `clean-checkout-20261022080112816-7e1509`
- environmentId: `local-jmachado-Precision-5530-644967`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap-sem-postgres | 1 | null | 480s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:45863 redis:35979
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em 127.0.0.1:33551 (nao usa o 8001 do desenvolvedor)
