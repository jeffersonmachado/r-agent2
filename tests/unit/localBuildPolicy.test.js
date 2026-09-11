'use strict';

const {
  analyzeDeployScript,
  analyzePackageScripts,
  analyzeDeployJs,
  analyzePolicyDoc,
  analyzeChecklist,
  analyzeCanonicalMemory,
} = require('../../scripts/governance/local-build-policy');

/**
 * Política canônica: o build de imagens Docker é SEMPRE local (workstation/CI) e
 * as imagens são transferidas para o servidor (`docker save | ssh 'docker load'`).
 * O servidor NUNCA constrói. Estes testes fixam o enforcement executável.
 */
describe('local-build-policy - build sempre local, servidor nunca constrói', () => {
  describe('analyzeDeployScript', () => {
    const baseScript = [
      '# NUNCA executar `docker build` ou `docker compose build` no servidor remoto',
      'build_local_image() {',
      '  docker build "$@" -t "$image" -f "$dockerfile" "$context"',
      '}',
      'UP_CMD="cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE up -d --no-build"',
      "ssh -o StrictHostKeyChecking=no root@host \"cd /srv && docker load -i api.tar\"",
    ].join('\n');

    it('aprova o script no formato canônico (build local + up remoto --no-build)', () => {
      expect(analyzeDeployScript(baseScript)).toEqual([]);
    });

    it('reprova up remoto sem --no-build', () => {
      const content = baseScript.replace('up -d --no-build', 'up -d');
      const reasons = analyzeDeployScript(content);
      expect(reasons.map((r) => r.code)).toContain('remote_up_without_no_build');
    });

    it('reprova build executado via ssh (build remoto)', () => {
      const content = `${baseScript}\nssh root@host "cd /srv && docker compose build api"`;
      const reasons = analyzeDeployScript(content);
      expect(reasons.map((r) => r.code)).toContain('remote_build_via_ssh');
    });

    it('reprova ausência do invariante documentado no script', () => {
      const content = baseScript.replace(/^# NUNCA.*\n/, '');
      const reasons = analyzeDeployScript(content);
      expect(reasons.map((r) => r.code)).toContain('deploy_script_invariant_missing');
    });
  });

  describe('analyzePackageScripts', () => {
    it('aprova deploy:up com --no-build', () => {
      expect(analyzePackageScripts({ 'deploy:up': 'docker-compose -f docker-compose.prod.yml up -d --no-build' })).toEqual([]);
    });

    it('reprova deploy:up sem --no-build (fail-open: construiria no servidor)', () => {
      const reasons = analyzePackageScripts({ 'deploy:up': 'docker-compose -f docker-compose.prod.yml up -d' });
      expect(reasons.map((r) => r.code)).toContain('deploy_up_without_no_build');
    });

    it('reprova script npm que executa build remoto via ssh', () => {
      const reasons = analyzePackageScripts({ 'deploy:evil': 'ssh root@host "docker compose build"' });
      expect(reasons.map((r) => r.code)).toContain('remote_build_via_ssh');
    });
  });

  describe('analyzeDeployJs', () => {
    it('aprova o caminho oficial que builda localmente a partir do artefato', () => {
      const content = "run('npm run deploy:build', 'Construindo imagens a partir do artefato extraído', artifactRoot, deployEnv);";
      expect(analyzeDeployJs(content)).toEqual([]);
    });

    it('reprova build remoto no orquestrador de deploy', () => {
      const content = "run('ssh root@host \"cd /srv && docker compose build\"', 'build remoto');";
      const reasons = analyzeDeployJs(content);
      expect(reasons.map((r) => r.code)).toContain('remote_build_via_ssh');
    });
  });

  describe('analyzePolicyDoc', () => {
    const doc = [
      '# Política de build local',
      'Fonte canônica: AI_MEMORY/deployment-rules.md',
      'Fluxo: docker save | gzip | ssh "gunzip | docker load"',
      'Proibido: docker build no servidor de produção',
    ].join('\n');

    it('aprova documento com mecanismo e fonte canônica', () => {
      expect(analyzePolicyDoc(doc)).toEqual([]);
    });

    it('reprova documento sem o mecanismo de transferência (docker save/docker load)', () => {
      const reasons = analyzePolicyDoc('# Política\nFonte canônica: AI_MEMORY/deployment-rules.md');
      expect(reasons.map((r) => r.code)).toContain('policy_doc_transfer_mechanism_missing');
    });

    it('reprova documento sem referência à fonte canônica', () => {
      const reasons = analyzePolicyDoc('docker save | docker load\n');
      expect(reasons.map((r) => r.code)).toContain('policy_doc_canonical_source_missing');
    });
  });

  describe('analyzeChecklist', () => {
    it('aprova checklist que aponta para a política e proíbe build no servidor', () => {
      const content = 'Ver docs/deployment/local-build-policy.md — nunca rodar docker build no servidor.';
      expect(analyzeChecklist(content)).toEqual([]);
    });

    it('reprova checklist sem a política de build local', () => {
      const reasons = analyzeChecklist('# Deploy\n1. subir containers\n');
      expect(reasons.map((r) => r.code)).toContain('checklist_local_build_policy_missing');
    });
  });

  describe('analyzeCanonicalMemory', () => {
    it('aprova memória canônica com a política de build local', () => {
      const content = '## Docker image build policy (canônica)\nO build é SEMPRE local (workstation/CI).';
      expect(analyzeCanonicalMemory(content)).toEqual([]);
    });

    it('reprova memória canônica sem a política', () => {
      const reasons = analyzeCanonicalMemory('# Deployment rules\nSem política de build.');
      expect(reasons.map((r) => r.code)).toContain('canonical_memory_policy_missing');
    });
  });
});
