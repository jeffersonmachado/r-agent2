'use strict';

/**
 * Prevenção EXECUTÁVEL da queda silenciosa da API de desenvolvimento.
 *
 * Contexto (medido 2026-10-01 e 2026-10-11): a API subida no terminal
 * (`kill … && setsid nohup node api/server.js … &`) morre quando o terminal é
 * reaproveitado/limpo, porque o `&` se aplica à CADEIA inteira e o job leva SIGTERM.
 * O sintoma engana: o log termina no MEIO de um tick, SEM stack trace (assinatura de
 * sinal, não de exceção) e o proxy do Vite passa a devolver 500 — parece bug de tela.
 *
 * Uma nota de memória não impede isso: quem não leu, repete. Estes testes travam, no
 * CI, as propriedades que fazem a classe do acidente não existir:
 *   1. a unit supervisionada existe, reinicia sozinha e tem a trava de tempestade nas
 *      seções CORRETAS (StartLimit* em [Unit]; em [Service] o systemd ignora em
 *      silêncio — erro real cometido em 2026-10-11);
 *   2. `systemd-analyze verify` aceita a unit RENDERIZADA de verdade (foi ele que
 *      pegou o erro da seção errada);
 *   3. o script de operação não volta ao padrão proibido e é fail-closed no dispatcher.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATE = path.join(ROOT, 'scripts', 'dev', 'ragent2-api-dev.service.template');
const SCRIPT = path.join(ROOT, 'scripts', 'dev', 'api-service.sh');
// A implementação é ÚNICA e vive em `service.sh` (api + rag + frontend). O
// `api-service.sh` continua existindo como wrapper de compatibilidade (smoke,
// converge e start-dev chamam esse caminho), então as asserções de política são
// feitas sobre o script real — validar o wrapper não provaria nada.
const SERVICE_SCRIPT = path.join(ROOT, 'scripts', 'dev', 'service.sh');

const template = fs.readFileSync(TEMPLATE, 'utf8');
const script = fs.readFileSync(SCRIPT, 'utf8');
const serviceScript = fs.readFileSync(SERVICE_SCRIPT, 'utf8');

/**
 * Código sem comentários.
 *
 * Os comentários deste par template+script DESCREVEM o padrão proibido (é o valor
deles: explicam por que a regra existe). Analisar o texto cru faria o teste acusar
a própria documentação — então as asserções negativas rodam sobre o código.
 */
function semComentarios(texto) {
  return texto
    .split('\n')
    .filter((linha) => !/^\s*#/.test(linha))
    .join('\n');
}

const scriptCode = semComentarios(serviceScript);

/** Seção REAL de uma unit (a linha `[Service]`, não a menção em comentário). */
function secaoDaUnit(conteudo, nome) {
  const match = new RegExp(`^\\[${nome}\\]$`, 'm').exec(conteudo);
  if (!match) return '';
  const inicio = match.index + match[0].length;
  const proxima = /^\[[A-Za-z]+\]$/m.exec(conteudo.slice(inicio));
  return proxima ? conteudo.slice(inicio, inicio + proxima.index) : conteudo.slice(inicio);
}

/** Renderiza como o script faz, para validar o artefato final (não o template cru). */
function renderTemplate({ root = ROOT, node = '/usr/bin/node', log = '/tmp/api.log' } = {}) {
  return template
    .split('{{ROOT}}').join(root)
    .split('{{NODE}}').join(node)
    .split('{{LOG}}').join(log);
}

describe('supervisão da API dev — a queda por terminal deixa de ser possível', () => {
  test('a unit existe e reinicia sozinha (sem depender de terminal)', () => {
    expect(fs.existsSync(TEMPLATE)).toBe(true);
    expect(template).toContain('Restart=always');
    expect(template).toMatch(/RestartSec=\d+/);
    expect(template).toContain('WorkingDirectory={{ROOT}}');
    expect(template).toContain('--env-file-if-exists=.env api/server.js');
    // Nada de `Type=forking`/detach: o processo supervisionado é o próprio node.
    expect(template).toContain('Type=simple');
  });

  test('a trava anti-tempestade está em [Unit] — em [Service] o systemd IGNORA', () => {
    const unitSection = secaoDaUnit(template, 'Unit');
    const serviceSection = secaoDaUnit(template, 'Service');
    expect(unitSection).toContain('StartLimitIntervalSec=');
    expect(unitSection).toContain('StartLimitBurst=');
    // Regressão do erro real de 2026-10-11: postas em [Service], são chaves
    // desconhecidas e o systemd as descarta sem erro — a trava viraria decoração.
    expect(serviceSection).not.toContain('StartLimitIntervalSec=');
    expect(serviceSection).not.toContain('StartLimitBurst=');
  });

  test('o log da unit fica em arquivo, nunca em stdout do terminal', () => {
    expect(template).toContain('StandardOutput=append:{{LOG}}');
    expect(template).toContain('StandardError=append:{{LOG}}');
  });

  test('o script de operação NÃO usa o padrão que mata a API', () => {
    // O padrão proibido: subir a API no terminal com a cadeia em background.
    expect(scriptCode).not.toMatch(/setsid\s+nohup[^\n]*api\/server\.js/);
    expect(scriptCode).not.toMatch(/nohup[^\n]*api\/server\.js[^\n]*&/);
    // E o caminho certo está de fato implementado.
    expect(scriptCode).toContain('systemctl --user');
    expect(scriptCode).toContain('daemon-reload');
    expect(template).toContain('Restart=always');
  });

  test('o script remove resíduo FORA do serviço (senão a porta 3001 fica de outro dono)', () => {
    expect(scriptCode).toContain('MainPID');
    expect(scriptCode).toContain('/proc/');
    // A limpeza é por PID com confirmação de identidade (cwd da instalação e
    // ControlGroup da unidade) — nunca `pkill` por substring, que casa com o
    // próprio shell que executa a busca (armadilha já medida).
    expect(scriptCode).not.toMatch(/\bpkill\b/);
    expect(scriptCode).not.toMatch(/\bfuser\s+-k\b/);
  });

  test('o dispatcher é fail-closed: subcomando desconhecido sai != 0 com o uso', () => {
    let erro = null;
    try {
      execFileSync('bash', [SCRIPT, 'subcomando-inexistente'], { stdio: 'pipe' });
    } catch (error) {
      erro = error;
    }
    expect(erro).not.toBeNull();
    expect(erro.status).toBe(2);
    expect(String(erro.stdout)).toContain('install');
  });

  test('o wrapper delega para a implementação única (sem duplicar política)', () => {
    // Dois scripts com a mesma política divergem com o tempo — foi assim que o
    // teardown do smoke passou a discordar do restore. O wrapper só encaminha.
    const wrapperCode = semComentarios(script);
    expect(wrapperCode).toMatch(/exec\s+bash\s+"\$AQUI\/service\.sh"/);
    expect(wrapperCode).toMatch(/\bapi\b/);
    expect(wrapperCode).not.toContain('systemctl');
    expect(wrapperCode).not.toContain('MainPID');
  });

  test('systemd-analyze verify aceita a unit RENDERIZADA (pega erro de seção/chave)', () => {
    let disponivel = true;
    try {
      execFileSync('systemd-analyze', ['--version'], { stdio: 'ignore' });
    } catch (_) {
      disponivel = false;
    }
    if (!disponivel) {
      // Sem systemd-analyze (containers/CI mínimo) o resto da suíte continua valendo.
      expect(template).toContain('Restart=always');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-unit-'));
    const file = path.join(dir, 'ragent2-api-dev.service');
    // HERMÉTICO (medido no CI, run 39590856414): o template substitui `{{NODE}}` por
    // `/usr/bin/node`, que NÃO existe no runner do GitHub — o systemd-analyze responde
    // "ragent2-api-dev.service: Command /usr/bin/node is not executable" e reprovava a
    // verificação por AMBIENTE, não por sintaxe. Renderizando com um executável que existe
    // (o próprio node do processo), o critério continua estrito (nenhuma linha pode citar a
    // unit) e passa a medir o que o teste diz medir: seção/chave inválida.
    fs.writeFileSync(file, renderTemplate({ node: process.execPath, log: path.join(dir, 'api.log') }));
    // stdout+stderr SEMPRE: avisos com exit 0 (Unknown key name) só aparecem assim.
    const r = spawnSync('systemd-analyze', ['verify', file], { encoding: 'utf8' });
    const saida = `${r.stdout || ''}${r.stderr || ''}`;
    // Só interessa o veredito sobre ESTA unit: outros arquivos do host têm avisos
    // próprios (teamviewerd, anydesk…) que não são da nossa conta.
    const linhasDaUnit = saida.split('\n').filter((linha) => linha.includes('ragent2-api-dev.service'));
    expect(linhasDaUnit).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a unit NÃO versiona segredo: credencial vem do .env, fora do git', () => {
    expect(template).not.toMatch(/API_KEY|SECRET|PASSWORD|TOKEN=/);
    expect(template).toContain('--env-file-if-exists=.env');
    // `.env` é lido do diretório de trabalho, nunca embutido no arquivo da unit.
    expect(template).not.toMatch(/EnvironmentFile=.*\.env/);
  });

  test('o caminho oficial (npm run dev) NÃO recria a API presa ao terminal', () => {
    const startDev = fs.readFileSync(path.join(ROOT, 'scripts', 'start-dev.sh'), 'utf8');
    const startDevCode = semComentarios(startDev);
    // O defeito original: `npx nodemon api/server.js &` + `kill_port $API_PORT`.
    expect(startDevCode).not.toMatch(/nodemon\s+api\/server\.js/);
    expect(startDevCode).not.toMatch(/npx\s+--yes\s+nodemon/);
    expect(startDevCode).not.toMatch(/kill_port\s+\$API_PORT/);
    // E delega para o serviço supervisionado.
    expect(startDevCode).toContain('scripts/dev/api-service.sh');
  });

  test('matar a API no caminho oficial só é possível no modo legado EXPLÍCITO', () => {
    const startDev = fs.readFileSync(path.join(ROOT, 'scripts', 'start-dev.sh'), 'utf8');
    const startDevCode = semComentarios(startDev);
    const linhas = startDevCode.split('\n');
    const flag = linhas.findIndex((linha) => linha.includes('RAGENT2_MANAGE_API'));
    expect(flag).toBeGreaterThan(-1);
    // Alvos que são a API: qualquer coleta/ataque a `nodemon.*server.js` ou
    // `node.*server.js` (outros `kill -9` do script são legítimos: RAG/frontend).
    const alvosDaApi = linhas
      .map((linha, indice) => ({ linha, indice }))
      .filter(({ linha }) => /nodemon\.\*server\.js|node\.\*server\.js/.test(linha));
    expect(alvosDaApi.length).toBeGreaterThan(0); // se sumirem, o teste virou vácuo
    for (const alvo of alvosDaApi) {
      expect(alvo.indice).toBeGreaterThan(flag);
    }
  });

  test('o smoke prod-like para e RELIGA os serviços de dev pela UNIDADE (não por pkill)', () => {
    // Sem isto, a supervisão e o smoke brigam: o systemd revive o serviço em 3 s e a
    // stack Docker não consegue bindar :3001 — e o smoke é pré-requisito bloqueante
    // do `consolidate` da selagem (medido 2026-10-11).
    const smoke = fs.readFileSync(
      path.join(ROOT, 'scripts', 'smoke', 'run-scheduled-production-health-smoke.sh'),
      'utf8',
    );
    const smokeCode = semComentarios(smoke);
    expect(smokeCode).toMatch(/service\.sh"?\s+"\$1"\s+"\$2"/);
    expect(smokeCode).toContain('stop');
    expect(smokeCode).toContain('start');
    // A identidade do serviço vem do módulo compartilhado (uma fonte da verdade).
    expect(smokeCode).toContain('dev_unidade');
    // Se houver pkill no script, ele só pode existir DEPOIS da checagem da unidade
    // (ramo de fallback, quando a supervisão não está instalada).
    const linhas = smokeCode.split('\n');
    const checagemUnidade = linhas.findIndex((linha) => /unidade_instalada|systemctl --user cat/.test(linha));
    expect(checagemUnidade).toBeGreaterThan(-1);
    const pkills = linhas
      .map((linha, indice) => ({ linha, indice }))
      .filter(({ linha }) => /\bpkill\b/.test(linha));
    for (const kill of pkills) {
      expect(kill.indice).toBeGreaterThan(checagemUnidade);
    }
  });

  test('o preflight do ciclo longo SOBE a API pela unidade (não só aconselha)', () => {
    // "API viva no health" não distingue API supervisionada de API solta: uma API
    // presa ao terminal passa no preflight e pode morrer no meio do run (medido
    // 2026-10-11 — 22 min de regressão sem API). O preflight precisa AGIR.
    const converge = fs.readFileSync(
      path.join(ROOT, 'scripts', 'governance', 'converge-governance.sh'),
      'utf8',
    );
    const convergeCode = semComentarios(converge);
    expect(convergeCode).toContain('systemctl --user is-active --quiet ragent2-api-dev');
    expect(convergeCode).toMatch(/api-service\.sh"?\s+start/);
    // O texto antigo afirmava "API sem supervisor" como se fosse o estado desejado —
    // era o oposto do que a medição mostrou.
    expect(convergeCode).not.toContain('API sem supervisor');
  });
});
