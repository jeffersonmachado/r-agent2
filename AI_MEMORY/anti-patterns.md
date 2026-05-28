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

