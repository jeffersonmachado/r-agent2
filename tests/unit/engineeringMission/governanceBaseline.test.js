'use strict';

/**
 * tests/unit/engineeringMission/governanceBaseline.test.js
 *
 * PROVA que a autoridade de governança é protegida por CONTEÚDO, não por nome.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (confirmado no código em 2026-10-02): o baseline capturava
 * `scripts/governance/*.js` apenas como uma LISTA DE NOMES (`readdirSync`). Um gate cujo corpo foi
 * alterado — `if (failure) return 'NO_GO'` virando `'GO'` — continuava existindo com o mesmo nome e
 * passava despercebido. Proteção por nome não protege nada.
 *
 * A segunda metade da suíte exercita a captura REAL contra o repositório: não é um teste de
 * laboratório sobre um objeto fabricado, é a leitura de verdade dos arquivos autoritativos.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const gb = require('../../../engine/engineeringMission/governanceBaseline');
const bugTriageService = require('../../../api/services/engineeringMission/bugTriageService');
const { verifyRuleBaseline, diffRuleBaseline } = require('../../../engine/engineeringMission/bugFinding/selfModification');

const ROOT = path.resolve(__dirname, '..', '..', '..');

describe('governanceBaseline — autoridade protegida por conteúdo', () => {
  describe('classificação de artefato autoritativo', () => {
    test('qualquer .js em scripts/governance é gate autoritativo (inclusive os que ainda não existem)', () => {
      expect(gb.classifyAuthorityFile('scripts/governance/validate-x.js')).toBe('AUTHORITATIVE_GATE');
      expect(gb.classifyAuthorityFile('scripts/governance/validate-totalmente-novo.js')).toBe('AUTHORITATIVE_GATE');
      expect(gb.classifyAuthorityFile('scripts/governance/lib/helper.js')).toBe('AUTHORITATIVE_GATE');
    });

    test('manifestos de testes obrigatórios têm classificação própria (gravidade maior)', () => {
      expect(gb.classifyAuthorityFile('config/engineering-bug-loop-required-tests.json')).toBe('REQUIRED_TESTS_MANIFEST');
      expect(gb.classifyAuthorityFile('config/engineering-router-v2-required-tests.json')).toBe('REQUIRED_TESTS_MANIFEST');
    });

    test('código comum NÃO entra no manifesto (o conjunto é derivado, não inflado)', () => {
      expect(gb.classifyAuthorityFile('api/services/foo.js')).toBeNull();
      expect(gb.classifyAuthorityFile('engine/utils/date.js')).toBeNull();
      expect(gb.classifyAuthorityFile('src/app.jsx')).toBeNull();
    });

    test('o diretório de gates É a lista: um gate novo entra sem ninguém listá-lo', () => {
      const manifest = gb.buildContentManifest([
        { path: 'scripts/governance/validate-a.js', sha256: 'a', size: 1 },
        { path: 'scripts/governance/novo-gate-2027.js', sha256: 'n', size: 2 },
        { path: 'api/services/irrelevante.js', sha256: 'x', size: 3 },
      ]);
      expect(Object.keys(manifest.files)).toContain('scripts/governance/validate-a.js');
      expect(Object.keys(manifest.files)).toContain('scripts/governance/novo-gate-2027.js');
      expect(Object.keys(manifest.files)).not.toContain('api/services/irrelevante.js');
      expect(manifest.skipped).toContain('api/services/irrelevante.js');
    });
  });

  describe('diferença de conteúdo', () => {
    const before = gb.buildContentManifest([
      { path: 'scripts/governance/validate-a.js', sha256: 'AAA', size: 100 },
      { path: 'scripts/governance/validate-b.js', sha256: 'BBB', size: 200 },
    ]);

    test('MESMO NOME, CONTEÚDO DIFERENTE é detectado como modificação', () => {
      const after = gb.buildContentManifest([
        { path: 'scripts/governance/validate-a.js', sha256: 'ZZZ', size: 104 },
        { path: 'scripts/governance/validate-b.js', sha256: 'BBB', size: 200 },
      ]);
      const diff = gb.diffContentManifest(before, after);
      expect(diff.modified).toEqual(['scripts/governance/validate-a.js']);
      expect(diff.changed).toBe(true);
      expect(diff.modifiedDetail[0]).toMatchObject({
        path: 'scripts/governance/validate-a.js', fromSize: 100, toSize: 104,
      });
    });

    test('gate REMOVIDO é detectado', () => {
      const after = gb.buildContentManifest([{ path: 'scripts/governance/validate-a.js', sha256: 'AAA', size: 100 }]);
      const diff = gb.diffContentManifest(before, after);
      expect(diff.removed).toEqual(['scripts/governance/validate-b.js']);
    });

    test('gate NOVO que passa a participar da decisão é detectado', () => {
      const after = gb.buildContentManifest([
        { path: 'scripts/governance/validate-a.js', sha256: 'AAA', size: 100 },
        { path: 'scripts/governance/validate-b.js', sha256: 'BBB', size: 200 },
        { path: 'scripts/governance/validate-c.js', sha256: 'CCC', size: 300 },
      ]);
      const diff = gb.diffContentManifest(before, after);
      expect(diff.added).toEqual(['scripts/governance/validate-c.js']);
    });

    test('nada mudou ⇒ changed=false', () => {
      const diff = gb.diffContentManifest(before, before);
      expect(diff.changed).toBe(false);
    });
  });

  describe('veredito com gravidade', () => {
    const baseline = gb.buildContentManifest([
      { path: 'scripts/governance/validate-a.js', sha256: 'AAA', size: 100 },
      { path: 'config/engineering-bug-loop-required-tests.json', sha256: 'MANIFEST', size: 500 },
    ]);

    test('inalterado ⇒ OK', () => {
      const verdict = gb.assessBaselineIntegrity({ baseline, current: baseline });
      expect(verdict.ok).toBe(true);
      expect(verdict.severity).toBe('NONE');
    });

    test('conteúdo de gate alterado sem mudar o nome ⇒ GOVERNANCE_BASELINE_VIOLATION (WEAKENING)', () => {
      const current = gb.buildContentManifest([
        { path: 'scripts/governance/validate-a.js', sha256: 'TAMPERED', size: 102 },
        { path: 'config/engineering-bug-loop-required-tests.json', sha256: 'MANIFEST', size: 500 },
      ]);
      const verdict = gb.assessBaselineIntegrity({ baseline, current });
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe('GOVERNANCE_BASELINE_VIOLATION');
      expect(verdict.severity).toBe('WEAKENING');
      expect(verdict.reason).toMatch(/forma mais discreta de afrouxar/);
    });

    test('REMOVER artefato autoritativo ⇒ STRUCTURAL_REMOVAL (mais grave que enfraquecer)', () => {
      const current = gb.buildContentManifest([{ path: 'config/engineering-bug-loop-required-tests.json', sha256: 'MANIFEST', size: 500 }]);
      const verdict = gb.assessBaselineIntegrity({ baseline, current });
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe('GOVERNANCE_BASELINE_STRUCTURAL_REMOVAL');
      expect(verdict.severity).toBe('STRUCTURAL_REMOVAL');
      expect(gb.isMoreSevere(verdict.severity, 'WEAKENING')).toBe(true);
    });

    test('manifesto de testes obrigatórios alterado ⇒ STRUCTURAL_REMOVAL, mesmo sem remoção de arquivo', () => {
      const current = gb.buildContentManifest([
        { path: 'scripts/governance/validate-a.js', sha256: 'AAA', size: 100 },
        { path: 'config/engineering-bug-loop-required-tests.json', sha256: 'AFROUXADO', size: 480 },
      ]);
      const verdict = gb.assessBaselineIntegrity({ baseline, current });
      expect(verdict.ok).toBe(false);
      expect(verdict.severity).toBe('STRUCTURAL_REMOVAL');
    });

    test('AVAL HUMANO explícito transforma a alteração em DECLARADA (nunca em silenciosa)', () => {
      const current = gb.buildContentManifest([
        { path: 'scripts/governance/validate-a.js', sha256: 'TAMPERED', size: 102 },
        { path: 'config/engineering-bug-loop-required-tests.json', sha256: 'MANIFEST', size: 500 },
      ]);
      const verdict = gb.assessBaselineIntegrity({ baseline, current, humanAuthorization: { allowed: true, actor: 'humano@results' } });
      expect(verdict.ok).toBe(true);
      expect(verdict.code).toBe('GOVERNANCE_BASELINE_HUMAN_AUTHORIZED');
      expect(verdict.authorized).toBe(true);
      expect(verdict.reason).toMatch(/aval humano explícito/);
    });

    test('sem baseline não há veredito favorável (fail-closed)', () => {
      const verdict = gb.assessBaselineIntegrity({ baseline: null, current: baseline });
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe('GOVERNANCE_BASELINE_UNVERIFIED');
    });
  });

  describe('REGISTRO REAL do repositório (captura de verdade, não objeto fabricado)', () => {
    let snapshot;

    beforeAll(() => {
      snapshot = bugTriageService.captureGovernanceRuleSnapshot();
    });

    test('o manifesto contém os gates autoritativos com HASH DE CONTEÚDO', () => {
      const gatePaths = Object.keys(snapshot.contentManifest.files).filter((p) => p.startsWith('scripts/governance/'));
      // O diretório tem dezenas de gates; se a captura voltasse a ser por nome, este número cairia.
      expect(gatePaths.length).toBeGreaterThan(10);
      for (const p of gatePaths.slice(0, 5)) {
        expect(snapshot.contentManifest.files[p]).toMatchObject({
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          classification: 'AUTHORITATIVE_GATE',
        });
      }
    });

    test('o hash capturado corresponde ao CONTEÚDO real do arquivo em disco', () => {
      const rel = 'scripts/governance/validate-bug-autonomous-loop.js';
      expect(snapshot.contentManifest.files[rel]).toBeDefined();
      const real = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
      expect(snapshot.contentManifest.files[rel].sha256).toBe(real);
      expect(snapshot.contentManifest.files[rel].size).toBe(fs.statSync(path.join(ROOT, rel)).size);
    });

    test('o manifesto marca corretamente o manifesto de testes obrigatórios', () => {
      expect(snapshot.contentManifest.files['config/engineering-bug-loop-required-tests.json'].classification)
        .toBe('REQUIRED_TESTS_MANIFEST');
    });

    test('ENFRAQUECER UM GATE SEM MUDAR O NOME produz GOVERNANCE_BASELINE_VIOLATION', () => {
      // Fixture controlada: o MESMO arquivo, o MESMO nome, conteúdo alterado — exatamente
      // `if (failure) return 'NO_GO'` virando `'GO'`.
      const tampered = JSON.parse(JSON.stringify(snapshot));
      const gate = 'scripts/governance/validate-bug-autonomous-loop.js';
      tampered.files[gate] = 'CONTEUDO_ADULTERADO_SEM_MUDAR_O_NOME';
      tampered.contentManifest.files[gate].sha256 = 'CONTEUDO_ADULTERADO_SEM_MUDAR_O_NOME';

      const verdict = verifyRuleBaseline({ baseline: snapshot, current: tampered });
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe('GOVERNANCE_BASELINE_VIOLATION');
      expect(verdict.diff.files.modified).toContain(gate);
      expect(verdict.reason).toMatch(/PRÓPRIAS regras de julgamento/);
    });

    test('REMOVER um teste obrigatório do manifesto produz violação detectável', () => {
      const tampered = JSON.parse(JSON.stringify(snapshot));
      tampered.testManifest = tampered.testManifest.slice(0, -1);
      const diff = diffRuleBaseline(snapshot, tampered);
      expect(diff.testManifest.removed.length).toBe(1);
      expect(diff.changed).toBe(true);
    });

    test('o manifesto REAL é estável entre duas capturas consecutivas (reprodutível)', () => {
      const again = bugTriageService.captureGovernanceRuleSnapshot();
      expect(again.contentManifest.files).toEqual(snapshot.contentManifest.files);
    });

    test('REGRESSÃO — o mapa `files` deixou de conter SÓ configs: agora carrega o conteúdo dos gates', () => {
      // Antes da correção, `files` tinha exatamente os 5 arquivos de config e os gates entravam
      // apenas como NOMES em `mandatoryGates`. Era esse o furo: o nome não muda quando o corpo muda.
      const gateEntries = Object.keys(snapshot.files).filter((p) => p.startsWith('scripts/governance/'));
      expect(gateEntries.length).toBeGreaterThan(10);
      for (const p of gateEntries.slice(0, 3)) {
        expect(snapshot.files[p]).toMatch(/^[a-f0-9]{64}$/);
      }
      // E cada gate segue listado nominalmente também (as duas visões coexistem e concordam).
      expect(snapshot.mandatoryGates).toEqual(expect.arrayContaining(gateEntries));
    });

    test('TROCAR O CONTEÚDO DE UM GATE mantendo o nome é detectado pelo mapa `files`', () => {
      const tampered = JSON.parse(JSON.stringify(snapshot));
      const gate = 'scripts/governance/validate-coverage-gate.js';
      const original = tampered.files[gate];
      tampered.files[gate] = 'conteudo-adulterado';
      const diff = diffRuleBaseline(snapshot, tampered);
      expect(diff.files.modified).toContain(gate);
      expect(diff.changed).toBe(true);
      expect(original).not.toBe(tampered.files[gate]);
    });
  });
});
