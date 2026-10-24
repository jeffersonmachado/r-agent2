# Clean checkout — corrupt-artifact

- commit: `9bb607c40cef376ef4f39b137b725e345d663752`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `6e2d0f666eac2483b6b31c6f71d3bef2a31c5c0354698be9ab62d8cf25e87b33`
- runId: `clean-checkout-20261024105120685-d33d0b`
- environmentId: `local-jmachado-Precision-5530-486756`
- veredito: **FAIL**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 95s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 38s | PASS |
| build-frontend | 0 | 0 | 35s | PASS |
| prod-like-smoke | 0 | 0 | 101s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| consumidor-artefato-corrompido | 1 | 1 | 6s | FAIL |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:37017 redis:34645
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:38107 (container rap-ci-clean-d33d0b-rag; nao usa o 8001 do desenvolvedor)
