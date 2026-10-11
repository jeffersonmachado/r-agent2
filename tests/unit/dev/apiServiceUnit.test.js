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
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATE = path.join(ROOT, 'scripts', 'dev', 'ragent2-api-dev.service.template');
const SCRIPT = path.join(ROOT, 'scripts', 'dev', 'api-service.sh');

const template = fs.readFileSync(TEMPLATE, 'utf8');
const script = fs.readFileSync(SCRIPT, 'utf8');

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

const scriptCode = semComentarios(script);

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
    // A limpeza é por PID com confirmação na cmdline — nunca `pkill` por substring,
    // que casa com o próprio shell que executa a busca (armadilha já medida).
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
    fs.writeFileSync(file, renderTemplate({ log: path.join(dir, 'api.log') }));
    let saida = '';
    try {
      execFileSync('systemd-analyze', ['verify', file], { stdio: 'pipe' });
    } catch (error) {
      saida = `${error.stdout || ''}${error.stderr || ''}`;
    }
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
});
