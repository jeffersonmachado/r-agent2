# Clean checkout — missing-artifact

- commit: `1e6a64b58d7daf9d0a5763be3173f6eeef4cd571`
- branch: `dev/engineering-hardening`
- sourceFingerprint: `11de55de75685675e1c971c163040a7effef196fbb3b70da1848d907da7a3a58`
- runId: `clean-checkout-20261022074558709-4ebc1d`
- environmentId: `local-jmachado-Precision-5530-616891`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 98s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 14s | PASS |
| build-frontend | 0 | 0 | 39s | PASS |
| prod-like-smoke | 0 | 0 | 119s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| consumidor-com-artefato | 0 | 0 | 8s | PASS |
| consumidor-sem-artefato | 1 | 1 | 5s | PASS |
| produtor-regenera | 0 | 0 | 69s | PASS |
| consumidor-apos-regenerar | 0 | 0 | 6s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:45295 redis:34481
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em 127.0.0.1:41315 (nao usa o 8001 do desenvolvedor)
