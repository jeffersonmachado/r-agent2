'use strict';

/**
 * Smoke LIVE do provider nativo de pesquisa (rede REAL — não é teste Jest).
 *
 * Busca e obtém páginas públicas de concorrentes através do provider nativo
 * (SSRF guard + DNS check + polidez por host incluídos) e imprime o que foi
 * efetivamente observado: httpStatus, contentHash, contentType, seções e
 * candidatos de capability extraídos. Nada é fabricado: falhas são impressas
 * com o código tipado.
 *
 * Uso: node scripts/smoke/research-native-provider-smoke.js
 * Exit 0 se pelo menos 2 das fontes forem obtidas com sucesso; 1 caso contrário.
 */

const { createNativeResearchProvider } = require('../../api/services/research/nativeResearchProvider');

const TARGETS = [
  'https://www.glofox.com/',
  'https://www.mindbodyonline.com/',
  'https://www.pushpress.com/',
];

const SEARCH_QUERIES = ['glofox', 'gym management software'];

function line(label, value) {
  process.stdout.write(`  ${label}: ${value}\n`);
}

(async () => {
  const provider = createNativeResearchProvider({
    options: { timeoutMs: 20000, minIntervalMsPerHost: 1000 },
  });

  process.stdout.write('research-native-provider-smoke (rede REAL)\n');
  process.stdout.write(`data: ${new Date().toISOString()}\n\n`);

  let glofoxFound = false;
  for (const query of SEARCH_QUERIES) {
    process.stdout.write(`search: "${query}"\n`);
    try {
      const search = await provider.search({ query });
      line('backend', search.backend || '(nenhum)');
      line('candidatos', search.candidates.length);
      for (const candidate of search.candidates.slice(0, 5)) {
        line('-', `[${candidate.source}] ${candidate.title} → ${candidate.url}`);
      }
      if (search.reason) line('motivo (vazio honesto)', search.reason);
      if (query === 'glofox') {
        glofoxFound = search.candidates.some((candidate) => candidate.url === 'https://www.glofox.com/');
      }
    } catch (error) {
      line('ERRO', `${error.code || 'unknown'} — ${error.message}`);
    }
    process.stdout.write('\n');
  }

  let successes = 0;
  for (const url of TARGETS) {
    process.stdout.write(`fetch: ${url}\n`);
    try {
      const fetched = await provider.fetch({ url });
      line('httpStatus', fetched.httpStatus);
      line('contentType', fetched.contentType);
      line('bytes', Buffer.byteLength(fetched.content, 'utf8'));
      line('retrievedAt', fetched.retrievedAt);
      line('contentHash', fetched.contentHash);

      if (fetched.httpStatus < 400 && fetched.content) {
        successes += 1;
        const docs = await provider.inspectDocumentation({
          url,
          content: fetched.content,
          contentHash: fetched.contentHash,
        });
        line('sections', docs.sections.length);
        if (docs.sections.length > 0) line('primeiras seções', docs.sections.slice(0, 5).join(' | '));
        line('capability candidates', docs.capabilities.length);
        line('journey candidates', docs.journeys.length);
        line('rule candidates', docs.rules.length);

        const api = await provider.inspectApiDocs({
          url,
          content: fetched.content,
          contentHash: fetched.contentHash,
        });
        line('api surface', api.status === 'NOT_APPLICABLE'
          ? `NOT_APPLICABLE (${api.reason})`
          : `${api.format}: ${api.operations.length} operações`);

        const evidence = await provider.captureEvidence({
          url,
          contentHash: fetched.contentHash,
          contentType: fetched.contentType,
        });
        line('evidenceRef', evidence.evidenceRef);
      } else {
        line('RESULTADO', 'status não confirmado — nada inspecionado (honesto)');
      }
    } catch (error) {
      line('ERRO', `${error.code || 'unknown'} — ${error.message}`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(`sucesso em ${successes}/${TARGETS.length} fontes\n`);
  process.stdout.write(`glofox encontrado via busca real: ${glofoxFound ? 'SIM' : 'NÃO'}\n`);
  process.exit(successes >= 2 && glofoxFound ? 0 : 1);
})().catch((error) => {
  process.stderr.write(`smoke falhou: ${error.message}\n`);
  process.exit(1);
});
