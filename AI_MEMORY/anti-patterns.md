# Anti-Patterns

Forbidden or dangerous practices:

- Declaring release success while QA Mesh or release gate is `NO_GO`.
- Treating route name guesses as runtime truth without browser validation.
- Creating duplicate architecture docs instead of referencing canonical docs.
- Adding PM2.
- Committing `.env`, `.token.env`, local credentials, tokens, dumps, backups or generated browser auth caches.
- Adding `node_modules` or transient runtime state to release payloads.
- Replacing replay integrity with screenshots only.
- Ignoring browser console errors, failed network requests or route-level 401/404.
- Using synthetic fallback as proof of real runtime.
- Editing `.impl.js` wrappers incorrectly when local convention says implementation lives in `.impl.js`.
- Adding direct DB or in-memory bypasses that weaken tenant isolation.
- Declarar cobertura de jornada de negócio com passo vacuoso: navegar para tela de QA
  (`/dev/*`), RPA técnico ou `/support` (superfície deprecada) e assertar apenas
  `<body>` exists. É cobertura declarada que não exercita o negócio — e ainda viola a
  segregação de experiência (tela DEVELOPMENT dentro de jornada PRODUCTION).
- Teste que MUTA artefato gerado e compartilhado do repositório (ex.: apagar/reescrever
  `reports/*.json` que outro teste lê): o Jest executa ARQUIVOS de teste em PARALELO, então
  a suíte passa com o arquivo isolado e FALHA no agregado, sem relação com código de
  produção. Backup/restore em `afterEach` NÃO isola entre arquivos. Teste que muta deve
  operar em caminho TEMPORÁRIO via override do produtor (ex.: `JOURNEY_PROJECTIONS_OUTPUT_PATH`
  definido antes do `require`), nunca no artefato real.

