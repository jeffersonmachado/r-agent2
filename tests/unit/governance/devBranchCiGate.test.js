'use strict';

/**
 * CI DA BRANCH DE DESENVOLVIMENTO AUDITÁVEL (FASE 7 / P0 — 2026-10-16).
 *
 * DEFEITO MEDIDO: nenhum workflow disparava para `dev/engineering-hardening` —
 * `gh run list --branch dev/engineering-hardening` devolvia `[]` (zero execuções).
 * Todo checkpoint publicado na branch de auditoria incremental chegava ao GitHub
 * sem verificação automática.
 *
 * SEGUNDO FATO MEDIDO (e que este teste NÃO esconde): o runner do GitHub não
 * inicia jobs por limite de gastos da conta —
 *
 *     gh run view 38881780959 ->
 *     "The job was not started because an Actions budget is preventing further use."
 *
 * Um workflow que não roda não é gate. Por isso a proteção efetiva é o runner
 * local versionado `scripts/ci/dev-branch-gate.js`, e o workflow é o ESPELHO que
 * passa a valer quando o runner voltar. Estes testes protegem as duas metades:
 *   (1) o workflow existe, cobre a branch, tem permissão mínima e não publica;
 *   (2) o runner local é o gate real: mesmo conjunto de passos, evidência ligada
 *       ao SHA exato, recusa SHA divergente e nunca publica nada.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'dev-branch-ci.yml');
const RUNNER = path.join(ROOT, 'scripts', 'ci', 'dev-branch-gate.js');

/**
 * Remove comentários de JS (`/* *​/`, `//`) e de YAML (`#`): as próprias notas
 * citam os comandos proibidos e o padrão de segredo, e sem isto o teste acusaria
 * a documentação em vez do código.
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => {
      const t = linha.trim();
      return !t.startsWith('//') && !t.startsWith('#');
    })
    .join('\n');
}

const ler = (abs) => fs.readFileSync(abs, 'utf8');

describe('(1) workflow do CI — cobre a branch de desenvolvimento com permissão mínima', () => {
  it('existe e dispara em push para dev/engineering-hardening', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
    const fonte = ler(WORKFLOW);
    expect(fonte).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\n\s*- dev\/engineering-hardening/);
  });

  it('declara permissões mínimas (contents: read) — não escreve no repositório', () => {
    expect(ler(WORKFLOW)).toContain('permissions:\n  contents: read');
  });

  it('não lê nem imprime segredo algum', () => {
    expect(semComentarios(ler(WORKFLOW))).not.toContain('secrets.');
  });

  it('não publica: sem tag, release, deploy, push ou publish', () => {
    const fonte = semComentarios(ler(WORKFLOW));
    for (const proibido of ['git push', 'gh release', 'gh tag', 'docker push', 'npm publish', 'git tag']) {
      expect(fonte.toLowerCase()).not.toContain(proibido);
    }
  });

  it('roda pelo MESMO runner versionado (uma implementação, não duas)', () => {
    expect(ler(WORKFLOW)).toContain('node scripts/ci/dev-branch-gate.js');
  });

  it('vincula a evidência ao SHA exato e publica o artefato do run', () => {
    const fonte = ler(WORKFLOW);
    expect(fonte).toContain('dev-branch-ci-evidence-${{ github.sha }}');
    expect(fonte).toContain('DEV_BRANCH_GATE_ESPERA_SHA: ${{ github.sha }}');
    expect(fonte).toMatch(/if: always\(\)/);
  });
});

describe('(2) runner local — o gate efetivo enquanto o runner do GitHub não inicia', () => {
  const { PASSOS, AUTORIZACAO_DA_FASE } = require('../../../scripts/ci/dev-branch-gate.js');
  const todos = Object.values(PASSOS).flat();

  it('define L0 e L1 obrigatórios, todos com id/nível/comando', () => {
    expect(todos.length).toBeGreaterThanOrEqual(6);
    const niveis = new Set(todos.map((p) => p.nivel));
    expect(niveis.has('L0')).toBe(true);
    expect(niveis.has('L1')).toBe(true);
    for (const p of todos) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.comando).toBe('string');
      expect(typeof p.descricao).toBe('string');
      expect(p.orcamentoMs).toBeGreaterThan(0);
    }
  });

  it('o L1 inclui a cadeia criptográfica e o self-proving (o falso GO da FASE 6)', () => {
    const comandos = todos.map((p) => p.comando).join('\n');
    expect(comandos).toContain('validate-governance-chain.js');
    expect(comandos).toContain('validate-self-proving.js');
  });

  it('cada fase técnica tem operação de elegibilidade declarada (Bug Closure First)', () => {
    expect(AUTORIZACAO_DA_FASE.C).toBe('L0_COMPLETO');
    expect(AUTORIZACAO_DA_FASE.D).toBe('L1_AMPLO');
    expect(AUTORIZACAO_DA_FASE.E).toBe('L2_L3_EXTENSIVO');
    expect(AUTORIZACAO_DA_FASE.F).toBe('SELO_FINAL');
    // Fase A é diagnóstico puro: nunca depende de autorização.
    expect(AUTORIZACAO_DA_FASE.A).toBeNull();
  });

  it('recusa executar quando o SHA exigido não é o HEAD (evidência ligada ao commit errado)', () => {
    const fonte = semComentarios(ler(RUNNER));
    expect(fonte).toContain('DEV_BRANCH_GATE_ESPERA_SHA');
    expect(fonte).toMatch(/RECUSADO/);
    expect(fonte).toContain('return 1;');
  });

  it('registra comando, exit code, duração e sha256 da saída de cada passo', () => {
    const fonte = semComentarios(ler(RUNNER));
    for (const campo of ['exitCode', 'duracaoMs', 'sha256Saida', 'comando']) {
      expect(fonte).toContain(campo);
    }
  });

  it('publica a evidência em Markdown versionado (o JSON solto em evidence/ é reprovado)', () => {
    const fonte = semComentarios(ler(RUNNER));
    // O diretório é configurável (testes não sobrescrevem a evidência real),
    // com AI_MEMORY/evidence como default.
    expect(fonte).toContain("process.env.DEV_BRANCH_GATE_EVIDENCE_DIR || 'AI_MEMORY/evidence'");
    expect(fonte).toContain('dev-branch-ci-');
    expect(fonte).toContain('.md');
    expect(fonte).toContain('reports/dev-branch-ci-evidence.json');
  });

  it('nunca publica release: sem push, tag, deploy ou publish', () => {
    const fonte = semComentarios(ler(RUNNER)).toLowerCase();
    for (const proibido of ['git push', 'git tag', 'gh release', 'npm publish', 'docker push', 'system:deploy']) {
      expect(fonte).not.toContain(proibido);
    }
  });

  it('o veredito deriva do exit code dos passos (falha não vira narrativa de sucesso)', () => {
    const fonte = semComentarios(ler(RUNNER));
    // Contrato P0 (2026-10-19): a decisão vem do estado REAL de cada fase,
    // derivado dos exit codes — nunca do texto da saída.
    expect(fonte).toContain('const comFalha = reais.filter((r) => r.exitCode !== 0);');
    expect(fonte).toContain("ESTADOS_DE_FASE.FAIL");
    expect(fonte).toContain("ESTADOS_DE_FASE.BLOCKED");
    expect(fonte).toContain("if (veredito === 'PASS') return 0;");
    expect(fonte).toContain("if (veredito === 'FAIL') return 1;");
    expect(fonte).toContain('return 2;');
  });

  it('escopo parcial NUNCA produz PASS (modo rápido não parece validação completa)', () => {
    const fonte = semComentarios(ler(RUNNER));
    expect(fonte).toContain("'PASS_PARCIAL'");
    expect(fonte).toContain('equivalenteAValidacaoCompleta');
    // Só o veredito completo (todas as obrigatórias comprovadas) é PASS.
    expect(fonte).toContain('const completo = veredito === \'PASS\';');
    expect(fonte).toMatch(/faltantes\.length > 0\) return 'PASS_PARCIAL'/);
  });

  it('consulta a elegibilidade ANTES de cada fase técnica e para no primeiro bloqueio', () => {
    const fonte = semComentarios(ler(RUNNER));
    expect(fonte).toContain('evaluateExecutionEligibility');
    expect(fonte).toContain('AUTORIZACAO_DA_FASE[fase]');
    expect(fonte).toContain("if (!autorizacao.allowed)");
    expect(fonte).toContain('FASE_NAO_AUTORIZADA');
  });
});
