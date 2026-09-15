'use strict';

/**
 * Native Research Provider — inspeções PURAS (determinísticas sobre o conteúdo)
 * e captura de evidência (valida + normaliza; persistir é do chamador).
 */

const crypto = require('crypto');

const {
  RESEARCH_PROVIDER_ERROR_CODES,
  createNativeResearchProvider,
} = require('../../../api/services/research/nativeResearchProvider');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function buildProvider() {
  return createNativeResearchProvider({
    transport: async () => { throw new Error('transporte não deve ser chamado em inspeção'); },
    resolveAddresses: async () => ['93.184.216.34'],
    now: () => 1_700_000_000_000,
    sleep: async () => {},
    logger: silent,
  });
}

function sha256Prefixed(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

const DOCS_FIXTURE = `<html><body>
<h1>Funcionalidades da plataforma</h1>
<p>Gestão de matrículas e planos para academias</p>
<h2>Cobrança e billing</h2>
<p>Cobrança recorrente de mensalidades com multa por atraso</p>
<h2>App do aluno</h2>
<p>Onboarding passo a passo do aluno</p>
<p>Congelamento de contrato por até 30 dias</p>
<script>var tracking = "billing nao conta";</script>
</body></html>`;

describe('nativeResearchProvider.inspectDocumentation', () => {
  test('extrai seções, capacidades, jornadas e regras COM locator na fonte', async () => {
    const provider = buildProvider();
    const output = await provider.inspectDocumentation({
      url: 'https://concorrente.example.com/funcionalidades',
      content: DOCS_FIXTURE,
      contentHash: sha256Prefixed(DOCS_FIXTURE),
    });

    expect(output.sections).toEqual([
      'Funcionalidades da plataforma',
      'Cobrança e billing',
      'App do aluno',
    ]);
    expect(output.contentHash).toBe(sha256Prefixed(DOCS_FIXTURE));

    const capabilityNames = output.capabilities.map((item) => item.name);
    expect(capabilityNames).toContain('Gestão de matrículas e planos para academias');
    expect(capabilityNames).toContain('Cobrança recorrente de mensalidades com multa por atraso');

    const journeyNames = output.journeys.map((item) => item.name);
    expect(journeyNames).toContain('Onboarding passo a passo do aluno');

    const ruleNames = output.rules.map((item) => item.name);
    expect(ruleNames).toContain('Congelamento de contrato por até 30 dias');

    // Todo item tem locator e fragmentHash determinístico.
    for (const kind of ['capabilities', 'journeys', 'rules']) {
      for (const item of output[kind]) {
        expect(item.locator).toMatch(/^(section:|line:\d+)/);
        expect(item.fragmentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    }
    const matriculas = output.capabilities.find((item) => item.name.includes('matrículas'));
    expect(matriculas.locator).toBe('section:Funcionalidades da plataforma');

    // Conteúdo de <script> NUNCA vira achado.
    expect(JSON.stringify(output)).not.toContain('nao conta');
  });

  test('é DETERMINÍSTICO: mesmo conteúdo, mesma saída', async () => {
    const provider = buildProvider();
    const first = await provider.inspectDocumentation({ url: 'https://x.example.com', content: DOCS_FIXTURE });
    const second = await provider.inspectDocumentation({ url: 'https://x.example.com', content: DOCS_FIXTURE });
    expect(second).toEqual(first);
  });

  test('hash divergente do conteúdo é RECUSADO (research_content_hash_mismatch)', async () => {
    const provider = buildProvider();
    const forged = sha256Prefixed('outro conteudo');
    await expect(provider.inspectDocumentation({
      url: 'https://x.example.com',
      content: DOCS_FIXTURE,
      contentHash: forged,
    })).rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.HASH_MISMATCH });
  });

  test('texto puro sem headings usa locator de linha', async () => {
    const provider = buildProvider();
    const plain = 'Bem-vindo\nCancelamento com multa de 20%\n';
    const output = await provider.inspectDocumentation({ content: plain });
    expect(output.sections).toEqual([]);
    const rule = output.rules.find((item) => item.name.includes('Cancelamento'));
    expect(rule.locator).toBe('line:2');
  });
});

const OPENAPI_FIXTURE = JSON.stringify({
  openapi: '3.0.1',
  info: { title: 'Gym API', version: '1.0' },
  paths: {
    '/members': {
      get: { summary: 'List members', operationId: 'listMembers' },
      post: { operationId: 'createMember' },
    },
    '/checkins/{id}': {
      delete: { summary: 'Cancel check-in' },
    },
  },
});

describe('nativeResearchProvider.inspectApiDocs', () => {
  test('OpenAPI/Swagger real: operações e capacidades a partir do contrato', async () => {
    const provider = buildProvider();
    const output = await provider.inspectApiDocs({
      url: 'https://dev.concorrente.example.com/openapi.json',
      content: OPENAPI_FIXTURE,
      contentHash: sha256Prefixed(OPENAPI_FIXTURE),
    });

    expect(output.format).toBe('openapi');
    expect(output.specVersion).toBe('3.0.1');
    expect(output.operations).toEqual(['GET /members', 'POST /members', 'DELETE /checkins/{id}']);
    const names = output.capabilities.map((item) => item.name);
    expect(names).toEqual(['List members', 'createMember', 'Cancel check-in']);
    expect(output.capabilities[0].locator).toBe('operation:GET /members');
  });

  test('HTML sem superfície de API é NOT_APPLICABLE honesto — nunca inventa endpoint', async () => {
    const provider = buildProvider();
    const output = await provider.inspectApiDocs({
      url: 'https://concorrente.example.com/',
      content: '<html><body><h1>Academia feliz</h1><p>Aulas e treinos.</p></body></html>',
    });
    expect(output.status).toBe('NOT_APPLICABLE');
    expect(output.reason).toBe('no_api_surface_detected');
    expect(output.operations).toEqual([]);
    expect(output.capabilities).toEqual([]);
  });

  test('menções de endpoint em HTML viram operações observadas', async () => {
    const provider = buildProvider();
    const html = '<html><body><p>Use GET /v1/members e POST /v1/checkins para integrar. GET /v1/members de novo.</p></body></html>';
    const output = await provider.inspectApiDocs({ content: html });
    expect(output.format).toBe('html-endpoint-mentions');
    expect(output.operations).toEqual(['GET /v1/members', 'POST /v1/checkins']);
  });

  test('hash divergente é recusado também na inspeção de API', async () => {
    const provider = buildProvider();
    await expect(provider.inspectApiDocs({
      content: OPENAPI_FIXTURE,
      contentHash: sha256Prefixed('forjado'),
    })).rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.HASH_MISMATCH });
  });
});

describe('nativeResearchProvider.captureEvidence', () => {
  test('referência determinística e hash normalizado', async () => {
    const provider = buildProvider();
    const hash = sha256Prefixed('documento');
    const first = await provider.captureEvidence({
      url: 'https://concorrente.example.com/docs',
      contentHash: hash,
      contentType: 'text/html',
    });
    const second = await provider.captureEvidence({
      url: 'https://concorrente.example.com/docs',
      contentHash: hash,
      contentType: 'text/html',
    });

    expect(first.evidenceRef).toBe(second.evidenceRef);
    expect(first.evidenceRef).toMatch(/^ev-[0-9a-f]{40}$/);
    expect(first.contentHash).toBe(hash);
    expect(first.capturedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  test('aceita hash hexadecimal cru e normaliza para sha256:', async () => {
    const provider = buildProvider();
    const hex = crypto.createHash('sha256').update('doc', 'utf8').digest('hex');
    const output = await provider.captureEvidence({ url: 'https://x.example.com', contentHash: hex.toUpperCase() });
    expect(output.contentHash).toBe(`sha256:${hex}`);
  });

  test('url inválida, protocolo proibido ou hash ausente/malformado são research_evidence_invalid', async () => {
    const provider = buildProvider();
    const hash = sha256Prefixed('doc');
    await expect(provider.captureEvidence({ contentHash: hash }))
      .rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID });
    await expect(provider.captureEvidence({ url: 'file:///tmp/x', contentHash: hash }))
      .rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID });
    await expect(provider.captureEvidence({ url: 'https://x.example.com' }))
      .rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID });
    await expect(provider.captureEvidence({ url: 'https://x.example.com', contentHash: '1234' }))
      .rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID });
  });
});
