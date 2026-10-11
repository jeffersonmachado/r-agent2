'use strict';

/**
 * Supervisão GENERALIZADA dos serviços de dev (api + rag + frontend) e a política
 * de snapshot/teardown/restore usada pelo smoke prod-like.
 *
 * Defeitos REAIS medidos em 2026-10-11, todos encontrados por prova de execução e
 * travados aqui para não voltarem:
 *
 *  D1. Fallback duplicado: `curl … -w '%{http_code}' || printf '000'` produzia
 *      "000000" (o curl já imprime 000 em falha). Comparações com a string "000"
 *      paravam de funcionar — a decisão de "estava parado" nunca era reconhecida.
 *  D2. Mesmo defeito em `systemctl is-active … || echo unknown`: o comando imprime
 *      "inactive" E sai com código != 0, então a saída virava "inactive\nunknown",
 *      injetando um campo FANTASMA no snapshot (um serviço chamado "unknown").
 *  D3. Restauração não seletiva: o RAG que o operador havia deixado PARADO era
 *      parado (de novo) e RELIGADO pelo smoke — o smoke mudava o ambiente.
 *  D4. Resíduo falso positivo: filhos legítimos do serviço (`sh -c vite …`,
 *      `node …/vite`) casam o mesmo padrão de linha de comando do processo
 *      principal; a limpeza que pulava apenas o MainPID os MATARIA, derrubando o
 *      serviço que estava no ar.
 *
 * A política é um único módulo (`scripts/dev/lib/servicos-dev-state.sh`) consumido
 * pelo smoke — não há duas fontes de verdade sobre o que significa "estava no ar".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVICE = path.join(ROOT, 'scripts', 'dev', 'service.sh');
const LIB = path.join(ROOT, 'scripts', 'dev', 'lib', 'servicos-dev-state.sh');
const SMOKE = path.join(ROOT, 'scripts', 'smoke', 'run-scheduled-production-health-smoke.sh');

const serviceCode = fs
  .readFileSync(SERVICE, 'utf8')
  .split('\n')
  .filter((linha) => !/^\s*#/.test(linha))
  .join('\n');
const libCode = fs.readFileSync(LIB, 'utf8');
const smoke = fs.readFileSync(SMOKE, 'utf8');
const smokeCode = smoke
  .split('\n')
  .filter((linha) => !/^\s*#/.test(linha))
  .join('\n');

/** Renderiza um template como o script faz (todos os placeholders). */
function renderTemplate(nome, { root = ROOT, log = '/tmp/x.log' } = {}) {
  return fs
    .readFileSync(path.join(ROOT, 'scripts', 'dev', `${nome}.service.template`), 'utf8')
    .split('{{ROOT}}').join(root)
    .split('{{SERVICE_DIR}}').join(root)
    .split('{{LOG}}').join(log)
    .split('{{NODE}}').join('/usr/bin/node')
    .split('{{NPM}}').join('/usr/bin/npm')
    .split('{{UVICORN}}').join(path.join(root, 'rag-service', 'venv', 'bin', 'uvicorn'));
}

describe('supervisão generalizada dos serviços de dev', () => {
  test('os TRÊS serviços têm template versionado, com restart e trava anti-tempestade em [Unit]', () => {
    for (const nome of ['ragent2-api-dev', 'ragent2-rag-dev', 'ragent2-frontend-dev']) {
      const template = renderTemplate(nome);
      expect(template).toContain('Restart=always');
      expect(template).toMatch(/RestartSec=\d+/);
      expect(template).toContain('StandardOutput=append:');
      const unit = /^\[Unit\]$/m.exec(template);
      const service = /^\[Service\]$/m.exec(template);
      expect(unit).not.toBeNull();
      expect(service).not.toBeNull();
      const secaoUnit = template.slice(unit.index, service.index);
      expect(secaoUnit).toContain('StartLimitIntervalSec=');
      expect(secaoUnit).toContain('StartLimitBurst=');
      // Em [Service] o systemd IGNORA StartLimit* em silêncio (erro já cometido).
      expect(template.slice(service.index)).not.toContain('StartLimitIntervalSec=');
    }
  });

  test('systemd-analyze verify aceita as TRÊS units renderizadas', () => {
    let disponivel = true;
    try {
      execFileSync('systemd-analyze', ['--version'], { stdio: 'ignore' });
    } catch (_) {
      disponivel = false;
    }
    if (!disponivel) {
      expect(libCode).toContain('deve_parar');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-units-'));
    for (const nome of ['ragent2-api-dev', 'ragent2-rag-dev', 'ragent2-frontend-dev']) {
      const file = path.join(dir, `${nome}.service`);
      fs.writeFileSync(file, renderTemplate(nome, { log: path.join(dir, `${nome}.log`) }));
      let saida = '';
      try {
        execFileSync('systemd-analyze', ['verify', file], { stdio: 'pipe' });
      } catch (error) {
        saida = `${error.stdout || ''}${error.stderr || ''}`;
      }
      const linhas = saida.split('\n').filter((linha) => linha.includes(`${nome}.service`));
      expect(linhas).toEqual([]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('nenhuma unit versiona segredo', () => {
    for (const nome of ['ragent2-api-dev', 'ragent2-rag-dev', 'ragent2-frontend-dev']) {
      expect(renderTemplate(nome)).not.toMatch(/API_KEY|SECRET|PASSWORD|TOKEN=/);
    }
    // O RAG lê o .env do próprio diretório (opcional: `-`), nunca embute segredo.
    expect(renderTemplate('ragent2-rag-dev')).toContain('EnvironmentFile=-');
  });

  test('o dispatcher cobre api/rag/frontend e falha fechado em serviço desconhecido', () => {
    expect(serviceCode).toContain('api rag frontend');
    let erro = null;
    try {
      execFileSync('bash', [SERVICE, 'status', 'servico-que-nao-existe'], { stdio: 'pipe' });
    } catch (error) {
      erro = error;
    }
    expect(erro).not.toBeNull();
    expect(erro.status).not.toBe(0);
    expect(`${erro.stdout}${erro.stderr}`).toContain('serviço desconhecido');
  });
});

describe('D1/D2 — normalização: fallback não pode DUPLICAR a saída', () => {
  test('o helper `|| printf`/`|| echo` não é usado em comandos que já imprimem valor', () => {
    // A forma correta é capturar em variável e só então aplicar o default.
    expect(serviceCode).not.toMatch(/curl[^\n]*\|\|\s*printf\s*'000'/);
    expect(smokeCode).not.toMatch(/is-active[^\n]*\|\|\s*(printf|echo)\s*'?(unknown|000)?/);
  });

  test('health_code devolve UM valor (mesmo quando o curl falha)', () => {
    // Executa o script real com um `curl` falso que só escreve "000" e sai != 0,
    // reproduzindo a condição que duplicava o código. O valor observado sai do
    // próprio `status`, que imprime `health=<code>`.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-fakecurl-'));
    fs.writeFileSync(
      path.join(dir, 'curl'),
      '#!/usr/bin/env bash\nprintf 000\nexit 7\n',
    );
    fs.writeFileSync(
      path.join(dir, 'systemctl'),
      // `show-environment` precisa responder OK: `require_systemd` usa essa chamada
      // para provar que existe D-Bus de usuário antes de qualquer operação.
      '#!/usr/bin/env bash\ncase "$*" in *show-environment*) exit 0 ;; esac\nprintf "inactive\\n"\nexit 3\n',
    );
    for (const bin of ['curl', 'systemctl']) fs.chmodSync(path.join(dir, bin), 0o755);
    const saida = execFileSync('bash', [SERVICE, 'status', 'rag'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    expect(saida).toContain('health=000');
    expect(saida).not.toContain('health=000000');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('D3 — o smoke restaura SÓ o que ele parou', () => {
  test('a política decide parar/preservar de forma explícita (tabela executada de verdade)', () => {
    const casos = [
      ['active', '200', '0'],
      ['activating', '000', '0'],
      ['reloading', '000', '0'],
      ['inactive', '200', '0'], // processo solto segurando a porta: PRECISA parar
      ['inactive', '000', '1'], // já estava desligado: PRESERVAR
      ['inactive', '', '1'], // D1: health vazio não é "000" nem "no ar"
      ['failed', '000', '1'],
      ['unknown', '000', '1'],
      ['sem_unidade', '200', '1'], // sem unidade não há restauração determinística
    ];
    const script = casos
      .map(([estado, health, esperado]) => `deve_parar ${estado} '${health}' && r=0 || r=1; [ "$r" = "${esperado}" ] || { echo "FALHOU ${estado}/${health} esperado ${esperado}"; exit 1; }`)
      .join('\n');
    const saida = execFileSync('bash', ['-c', `. "${LIB}"\n${script}\necho TODOS_OK`], {
      encoding: 'utf8',
    });
    expect(saida).toContain('TODOS_OK');
  });

  test('deve_restaurar só aceita quem foi marcado como parado', () => {
    const saida = execFileSync(
      'bash',
      ['-c', `. "${LIB}"; deve_restaurar parado && printf A; deve_restaurar preservado || printf B; deve_restaurar '' || printf C`],
      { encoding: 'utf8' },
    );
    expect(saida).toBe('ABC');
  });

  test('o snapshot usa delimitador fixo e não compara com a string "000"', () => {
    expect(smokeCode).toContain("IFS='|' read -r s estado health");
    // O critério de "estava no ar" vem do módulo compartilhado, não de um `if`
    // local que poderia divergir do restore.
    expect(smokeCode).toContain('deve_parar');
    expect(smokeCode).toContain('deve_restaurar');
    expect(smokeCode).not.toMatch(/"\$health"\s*=\s*"000"/);
  });

  test('o smoke tem trap de saída e restauração idempotente', () => {
    expect(smokeCode).toMatch(/trap\s+on_exit\s+EXIT\s+INT\s+TERM/);
    expect(smokeCode).toContain('RESTORE_CONCLUIDO=1');
    // Restauração no caminho NORMAL, antes do veredito final.
    const posRestore = smokeCode.indexOf('restore_dev_state');
    const posVeredito = smokeCode.indexOf('END status=');
    expect(posRestore).toBeGreaterThan(-1);
    expect(posVeredito).toBeGreaterThan(posRestore);
  });

  test('o snapshot cobre os TRÊS serviços (parar só a API deixava Vite/uvicorn presos à porta)', () => {
    expect(smokeCode).toContain('SERVICOS_DEV="api rag frontend"');
    expect(smokeCode).toContain('5173');
    expect(smokeCode).toContain('8001');
  });
});

describe('D4 — filho do serviço não é resíduo', () => {
  test('a identidade usa o ControlGroup da unidade (não só o MainPID)', () => {
    expect(serviceCode).toContain('ControlGroup');
    expect(serviceCode).toContain('proc_no_cgroup_da_unidade');
    // E a limpeza consulta essa identidade ANTES de matar.
    const posCheck = serviceCode.indexOf('proc_no_cgroup_da_unidade "$pid" "$servico" && continue');
    const posKill = serviceCode.indexOf('kill -TERM "$pid"');
    expect(posCheck).toBeGreaterThan(-1);
    expect(posKill).toBeGreaterThan(posCheck);
  });

  test('identidade por cwd também é exigida (protege OUTRA instalação do RAP)', () => {
    expect(serviceCode).toContain('proc_pertence_ao_root');
    expect(serviceCode).toContain('/proc/$pid/cwd');
    // cwd ilegível => não mexer (fail-closed).
    expect(serviceCode).toMatch(/\[ -n "\$cwd" \] \|\| return 1/);
  });

  test('o `stop` limpa resíduo fora da unidade (senão a porta continua ocupada)', () => {
    const posStop = serviceCode.indexOf('systemctl --user stop');
    const posReap = serviceCode.indexOf('reap_strays "$servico"', posStop);
    expect(posStop).toBeGreaterThan(-1);
    expect(posReap).toBeGreaterThan(posStop);
  });

  test('nenhum script usa pkill/fuser para derrubar serviço supervisionado', () => {
    for (const codigo of [serviceCode, smokeCode]) {
      expect(codigo).not.toMatch(/\bpkill\b/);
      expect(codigo).not.toMatch(/\bfuser\s+-k\b/);
    }
  });
});
