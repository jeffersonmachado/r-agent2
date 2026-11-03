# Clean checkout — missing-artifact

- commit: `83b50f1e4209522593d554a84a40b1d02abeb6cc`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `ba06659e6e7b7ee5327477f590e9191373514f9ad1140b2588985abcab322626`
- runId: `clean-checkout-20261024193858660-cb1dfd`
- environmentId: `local-jmachado-Precision-5530-1409118`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 127s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 24s | PASS |
| build-frontend | 0 | 0 | 53s | PASS |
| prod-like-smoke | 0 | 0 | 119s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| consumidor-com-artefato | 0 | 0 | 11s | PASS |
| consumidor-sem-artefato | 1 | 1 | 5s | PASS |
| produtor-regenera | 0 | 0 | 96s | PASS |
| consumidor-apos-regenerar | 0 | 0 | 17s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:46673 redis:35073
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:34693 (container rap-ci-clean-cb1dfd-rag; nao usa o 8001 do desenvolvedor)
