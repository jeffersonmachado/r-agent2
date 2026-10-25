# Clean checkout — missing-artifact

- commit: `eac0fae086d8513a6ffb58053080592157f20a02`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `ba06659e6e7b7ee5327477f590e9191373514f9ad1140b2588985abcab322626`
- runId: `clean-checkout-20261025142455642-58339f`
- environmentId: `local-jmachado-Precision-5530-2900306`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 135s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 36s | PASS |
| build-frontend | 0 | 0 | 40s | PASS |
| prod-like-smoke | 0 | 0 | 114s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| consumidor-com-artefato | 0 | 0 | 9s | PASS |
| consumidor-sem-artefato | 1 | 1 | 5s | PASS |
| produtor-regenera | 0 | 0 | 73s | PASS |
| consumidor-apos-regenerar | 0 | 0 | 6s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:34737 redis:33651
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:42461 (container rap-ci-clean-58339f-rag; nao usa o 8001 do desenvolvedor)
