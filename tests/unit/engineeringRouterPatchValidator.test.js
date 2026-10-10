'use strict';

const { validatePatch, parseUnifiedDiff } = require('../../engine/engineeringRouter/patchValidator');

const VALID_DIFF = `diff --git a/src/foo.js b/src/foo.js
index 1234567..89abcde 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,3 @@
 function foo() {
-  return 1;
+  return 2;
 }
`;

describe('engineeringRouter/patchValidator', () => {
  test('rejeita texto que não é um unified diff (descrição em linguagem natural)', () => {
    const result = validatePatch('mude o arquivo X desta maneira: troque o valor de retorno para 2', { contract: {} });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_INVALID_FORMAT');
  });

  test('aceita um unified diff válido dentro do escopo autorizado', () => {
    const result = validatePatch(VALID_DIFF, { contract: { allowedPaths: ['src/**'] } });
    expect(result.ok).toBe(true);
    expect(result.touchedPaths).toEqual(['src/foo.js']);
  });

  test('rejeita patch fora do escopo autorizado', () => {
    const result = validatePatch(VALID_DIFF, { contract: { allowedPaths: ['scripts/governance/**'] } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_OUTSIDE_ALLOWED_SCOPE');
  });

  test('rejeita alteração binária', () => {
    const binaryDiff = `diff --git a/logo.png b/logo.png\nindex 111..222 100644\nGIT binary patch\nliteral 10\nabc\n`;
    const result = validatePatch(binaryDiff, { contract: {} });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'PATCH_BINARY_CHANGE')).toBe(true);
  });

  test('rejeita delete não autorizado por padrão', () => {
    const deleteDiff = `diff --git a/src/old.js b/src/old.js\ndeleted file mode 100644\nindex 111..000\n--- a/src/old.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n`;
    const result = validatePatch(deleteDiff, { contract: {} });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'PATCH_UNEXPECTED_DELETE')).toBe(true);
  });

  test('permite delete quando o contrato autoriza allowDeletes', () => {
    const deleteDiff = `diff --git a/src/old.js b/src/old.js\ndeleted file mode 100644\nindex 111..000\n--- a/src/old.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n`;
    const result = validatePatch(deleteDiff, { contract: { allowDeletes: true, allowedPaths: ['src/**'] } });
    expect(result.ok).toBe(true);
  });

  test('rejeita patch tocando arquivo de secret mesmo dentro do escopo', () => {
    const envDiff = `diff --git a/.env b/.env\nindex 111..222 100644\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-A=1\n+A=2\n`;
    const result = validatePatch(envDiff, { contract: { allowedPaths: ['.env'] } });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'PATCH_FORBIDDEN_FILE')).toBe(true);
  });

  // SEGURANÇA (2026-10-08) — a redação de segredos existia só no CONTEXTO DE ENTRADA e na saída de
  // comandos: o diff do CODER ia direto para validação/aplicação/persistência/promoção, com a única
  // defesa sendo a instrução no prompt e a proteção por NOME de arquivo. Uma chave colada dentro de
  // um arquivo de nome inocente atravessava tudo.
  describe('segredo no CONTEÚDO adicionado (fail-closed)', () => {
    const comAdicao = (add) => [
      'diff --git a/src/valores.js b/src/valores.js',
      '--- a/src/valores.js',
      '+++ b/src/valores.js',
      '@@ -1 +1,2 @@',
      ' const a = 1;',
      add,
      '',
    ].join('\n');

    const CHAVE_OPENAI = '+const k = "sk-projABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";';

    test('rejeita patch que ADICIONA uma chave de provider', () => {
      const result = validatePatch(comAdicao(CHAVE_OPENAI), { contract: { allowedPaths: ['src/**'] } });
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.code === 'PATCH_CONTAINS_SECRET');
      expect(issue).toBeTruthy();
      expect(issue.secretPatterns).toContain('OPENAI_STYLE_KEY');
    });

    test('rejeita bloco de chave privada PEM adicionado em várias linhas', () => {
      const pem = [
        'diff --git a/src/k.js b/src/k.js',
        '--- a/src/k.js',
        '+++ b/src/k.js',
        '@@ -1 +1,3 @@',
        ' const a = 1;',
        '+-----BEGIN RSA PRIVATE KEY-----',
        '+MIIEowIBAAKCAQEA1234567890abcdefghijklmnop',
        '+-----END RSA PRIVATE KEY-----',
        '',
      ].join('\n');
      const result = validatePatch(pem, { contract: { allowedPaths: ['src/**'] } });
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.code === 'PATCH_CONTAINS_SECRET')).toBe(true);
    });

    test('controle negativo: REMOVER o segredo é a CORREÇÃO — nunca a violação', () => {
      const remocao = [
        'diff --git a/src/valores.js b/src/valores.js',
        '--- a/src/valores.js',
        '+++ b/src/valores.js',
        '@@ -1,2 +1 @@',
        `-${CHAVE_OPENAI.slice(1)}`,
        ' const a = 1;',
        '',
      ].join('\n');
      expect(validatePatch(remocao, { contract: { allowedPaths: ['src/**'] } }).ok).toBe(true);
    });

    test('controle negativo: placeholder não é falso positivo', () => {
      const resultado = validatePatch(comAdicao('+const k = "sk-xxx";'), { contract: { allowedPaths: ['src/**'] } });
      expect(resultado.ok).toBe(true);
    });

    test('controle negativo: patch comum continua aceito', () => {
      expect(validatePatch(comAdicao('+const b = 2;'), { contract: { allowedPaths: ['src/**'] } }).ok).toBe(true);
    });

    test('a varredura ignora o cabeçalho +++ e olha só as adições', () => {
      const { addedContentFromDiff, findSecretsInAddedContent } = require('../../engine/engineeringRouter/patchValidator');
      const diff = comAdicao('+token = "curto"');
      expect(addedContentFromDiff(diff)).not.toContain('b/src/valores.js');
      expect(findSecretsInAddedContent(diff)).toEqual([]);
    });
  });


  describe('caminhos de INTEGRIDADE (fail-closed)', () => {
    const patchEm = (p) => `diff --git a/${p} b/${p}\nindex 111..222 100644\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-a\n+b\n`;

    const INTEGRIDADE = [
      'scripts/governance/validate-qualquer-coisa.js',
      'jest.config.cjs',
      '.github/workflows/release-governance.yml',
      'pipeline/runFullValidation.js',
      'tools/system/release.js',
      'governance/replay-integrity.js',
      'config/engineering-router-v2-required-tests.json',
      'config/timeout-policy.json',
      'config/journey-criticality.json',
    ];

    test.each(INTEGRIDADE)('recusa %s mesmo dentro do escopo autorizado', (alvo) => {
      const result = validatePatch(patchEm(alvo), { contract: { allowedPaths: ['**'] } });
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.code === 'PATCH_FORBIDDEN_FILE');
      expect(issue).toBeTruthy();
      expect(issue.integrityCriticalPaths).toContain(alvo);
    });

    test('a autorização é EXPLÍCITA no contrato — nunca um default', () => {
      const semAutorizacao = validatePatch(patchEm('jest.config.cjs'), { contract: { allowedPaths: ['**'] } });
      expect(semAutorizacao.ok).toBe(false);

      const comAutorizacao = validatePatch(patchEm('jest.config.cjs'), {
        contract: { allowedPaths: ['**'], integrityCriticalAuthorization: true },
      });
      expect(comAutorizacao.ok).toBe(true);
      expect(comAutorizacao.touchedPaths).toEqual(['jest.config.cjs']);
    });

    test('controle negativo: caminho comum NÃO é afetado', () => {
      const result = validatePatch(patchEm('api/services/foo/bar.js'), { contract: { allowedPaths: ['api/**'] } });
      expect(result.ok).toBe(true);
    });

    test('controle negativo: nome parecido não é falso positivo', () => {
      // `api/services/engineeringMission/governanceBaseline.js` contém "governance" no BASENAME,
      // não no diretório — não é maquinário de release.
      const result = validatePatch(patchEm('api/services/engineeringMission/governanceBaseline.js'), {
        contract: { allowedPaths: ['api/**'] },
      });
      expect(result.ok).toBe(true);
    });
  });

  test('rejeita patch maior que o limite de tamanho', () => {
    const result = validatePatch(VALID_DIFF, { contract: { allowedPaths: ['src/**'] }, maxPatchSizeBytes: 10 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_TOO_LARGE');
  });

  test('parseUnifiedDiff extrai arquivos e contagem de hunks', () => {
    const parsed = parseUnifiedDiff(VALID_DIFF);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].newPath).toBe('src/foo.js');
    expect(parsed.files[0].hunkCount).toBe(1);
  });
  // HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — achado real medido: o coder `qwen:qwen3-coder-flash`
  // emite CABEÇALHO de diff/hunk corretos e CORPO inteiramente sem prefixo ('+', '-' ou ' ').
  // `git apply` recusa o patch inteiro com "patch corrompido"; antes desta checagem a plataforma só
  // descobria isso no apply (PATCH_APPLY_FAILED, sem reroute) e queimava todas as iterações no mesmo
  // modelo. O corpo NUNCA é reparado heuristicamente — só recusado, de forma determinística.
  describe('corpo de hunk sem prefixo de unified diff', () => {
    const BARE_BODY_DIFF = `diff --git a/api/services/x.js b/api/services/x.js
new file mode 100644
index 00000000..5077281c
--- /dev/null
+++ b/api/services/x.js
@@ -0,0 +1,3 @@
'use strict';

const a = 1;
`;

    test('é rejeitado com PATCH_BODY_MISSING_PREFIX (antes de qualquer git apply)', () => {
      const result = validatePatch(BARE_BODY_DIFF, { contract: { allowedPaths: ['api/services/**'] } });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PATCH_BODY_MISSING_PREFIX');
      // O patch tem cabeçalho de arquivo E hunk válidos: a recusa é de CORPO, não de formato geral.
      expect(result.code).not.toBe('PATCH_INVALID_FORMAT');
    });

    test('a recusa é determinística e registra arquivo/hunk/contagens para diagnóstico', () => {
      const options = { contract: { allowedPaths: ['api/services/**'] } };
      const first = validatePatch(BARE_BODY_DIFF, options);
      const second = validatePatch(BARE_BODY_DIFF, options);

      const violation = first.issues[0].violations[0];
      expect(violation.path).toBe('api/services/x.js');
      expect(violation.hunkIndex).toBe(1);
      expect(violation.hunkHeader).toBe('@@ -0,0 +1,3 @@');
      expect(violation.bareLines).toBe(2); // "'use strict';" e "const a = 1;"
      expect(violation.emptyLines).toBe(1); // a linha vazia não é violação, só diagnóstico
      expect(violation.prefixedLines).toBe(0);
      expect(violation.declaredNewCount).toBe(3);
      expect(violation.bareExamples[0]).toBe("'use strict';");
      // Mesma entrada ⇒ mesma saída (nenhum estado, nenhuma heurística).
      expect(second.issues[0].violations).toEqual(first.issues[0].violations);
    });

    test('aponta o hunk exato quando só um deles traz corpo sem prefixo', () => {
      const twoHunks = `diff --git a/src/foo.js b/src/foo.js
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,2 +1,2 @@
 function foo() {
-  return 1;
+  return 2;
@@ -10,2 +10,2 @@
function bar() {
return 3;
`;
      const result = validatePatch(twoHunks, { contract: { allowedPaths: ['src/**'] } });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PATCH_BODY_MISSING_PREFIX');
      expect(result.issues[0].violations).toHaveLength(1);
      expect(result.issues[0].violations[0].hunkIndex).toBe(2);
      expect(result.issues[0].violations[0].bareLines).toBe(2);
    });

    test('NÃO marca hunk válido (nenhum falso positivo) e expõe lista vazia', () => {
      const valid = validatePatch(VALID_DIFF, { contract: { allowedPaths: ['src/**'] } });
      expect(valid.ok).toBe(true);
      expect(parseUnifiedDiff(VALID_DIFF).bodyPrefixViolations).toEqual([]);
      // Arquivo novo com corpo CORRETAMENTE prefixado (caso do INC-1 real, que aplicou em produção)
      const goodNewFile = `diff --git a/engine/x.js b/engine/x.js
new file mode 100644
--- /dev/null
+++ b/engine/x.js
@@ -0,0 +1,2 @@
+'use strict';
+const a = 1;
`;
      const accepted = validatePatch(goodNewFile, { contract: { allowedPaths: ['engine/**'] } });
      expect(accepted.ok).toBe(true);
      expect(accepted.files[0].hunkCount).toBe(1);
    });

    test('a detecção é CONSERVADORA: corpo misto continua sendo decidido pelo git apply real', () => {
      // Um corpo misto (algumas linhas prefixadas, outras não) não é marcado aqui — marcar exigiria
      // adivinhar intenção. Ele segue para `git apply --check`, cuja recusa vira PATCH_APPLY_FAILED,
      // que o roteador agora trata como falha de formato do CODER (reroute), nunca reparo silencioso.
      const mixed = `diff --git a/src/foo.js b/src/foo.js
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,3 @@
 function foo() {
   return 1;
`;
      const parsed = parseUnifiedDiff(mixed);
      expect(parsed.bodyPrefixViolations).toEqual([]);
    });

    test('pega o defeito REAL: corpo = conteúdo integral do arquivo (linhas indentadas contam como espaço)', () => {
      // Reprodução fiel do patch medido em runtime no provider: o header é válido e declara as
      // adições, o corpo é o ARQUIVO INTEIRO sem prefixo — as linhas indentadas do código começam
      // com espaço e passariam pela regra "nenhum prefixo", mas o header não deixa dúvida.
      const realDefect = `diff --git a/engine/eng-37fb84.js b/engine/eng-37fb84.js
new file mode 100644
index 00000000..5077281c
--- /dev/null
+++ b/engine/eng-37fb84.js
@@ -0,0 +1,130 @@
'use strict';

/**
 * Módulo de exemplo.
 */
function demo() {
  return 1;
}

module.exports = { demo };
`;
      const result = validatePatch(realDefect, { contract: { allowedPaths: ['engine/**'] } });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PATCH_BODY_MISSING_PREFIX');
      const violation = result.issues[0].violations[0];
      expect(violation.path).toBe('engine/eng-37fb84.js');
      expect(violation.hunkIndex).toBe(1);
      expect(violation.declaredOldCount).toBe(0);
      expect(violation.declaredNewCount).toBe(130);
      expect(violation.plusLines).toBe(0);
      expect(violation.minusLines).toBe(0);
      expect(violation.spaceLines).toBeGreaterThan(0); // a indentação do código não engana a detecção
      expect(violation.reasons.some((r) => r.includes('adicionada'))).toBe(true);
    });

    test('NÃO marca hunk legítimo que só tem contexto', () => {
      const contextOnlyHunk = `diff --git a/src/foo.js b/src/foo.js
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,3 @@
 function foo() {
   return 1;
 }
`;
      expect(parseUnifiedDiff(contextOnlyHunk).bodyPrefixViolations).toEqual([]);
    });

    test('NÃO marca hunk de remoção pura legítimo', () => {
      const removal = `diff --git a/src/old.js b/src/old.js
deleted file mode 100644
--- a/src/old.js
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
`;
      expect(parseUnifiedDiff(removal).bodyPrefixViolations).toEqual([]);
      // O delete é recusado pela política de contrato (allowDeletes), NÃO por formato de corpo.
      const result = validatePatch(removal, { contract: {} });
      expect(result.issues.some((i) => i.code === 'PATCH_UNEXPECTED_DELETE')).toBe(true);
      expect(result.code).not.toBe('PATCH_BODY_MISSING_PREFIX');
    });
  });
});

