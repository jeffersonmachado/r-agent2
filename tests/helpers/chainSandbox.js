'use strict';

/**
 * SANDBOX DE CADEIA COM O LAYOUT CANÔNICO (missão 2026-10-25).
 *
 * Desde o P0 de caminho canônico, `verifyChain` não localiza arquivos por `link.path` — ele deriva o
 * caminho canônico de CADA id a partir da arquitetura (`buildChainLayers`) e exige que o elo aponte
 * para ele. Fixtures que usam caminhos arbitrários em `/tmp` deixaram de representar uma cadeia
 * possível em produção.
 *
 * Este helper cria um `raiz` temporário com o MESMO layout do repositório
 * (`governance/<arquivo canônico>`, `dist/release/<zip|manifest>`) e devolve:
 *   - `raiz`       : diretório do sandbox (passado como `opcoes.raiz` à verificação);
 *   - `artifact`   : artefato no formato de `findLatestReleaseArtifact` (passado como `opcoes.artifact`);
 *   - `opcoes`     : `{ raiz, artifact }` pronto para `verifyChain(chain, opcoes)`;
 *   - `caminhos`   : mapa canônico já materializado (10 ids, ordem canônica);
 *   - `montar(opcoes)` : monta a cadeia em forma canônica, com hashes reais dos bytes;
 *   - `limpar()`   : remove o sandbox.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GENESIS_HASH,
  ORDEM_CANONICA,
  caminhosCanonicos,
  sha256File,
  sha256String,
} = require('../../governance/governance-chain');

function criarSandboxDeCadeia(prefixo = 'chain-sandbox-') {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  const dist = path.join(raiz, 'dist', 'release');
  fs.mkdirSync(dist, { recursive: true });

  const artifact = {
    zipPath: path.join(dist, 'r-agent2-teste.zip'),
    manifestPath: path.join(dist, 'r-agent2-teste.manifest.json'),
  };
  fs.writeFileSync(artifact.zipPath, 'ZIP-DE-TESTE');
  fs.writeFileSync(artifact.manifestPath, JSON.stringify({ artifact: 'teste' }));

  const opcoes = { raiz, artifact };
  const caminhos = caminhosCanonicos(opcoes);

  for (const item of caminhos) {
    if (!item.resolvido) continue;
    const abs = path.join(raiz, item.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, JSON.stringify({ elo: item.id }));
  }

  /**
   * @param {{ omitir?: string, duplicar?: string, inverter?: boolean, adulterarHashDe?: string,
   *          caminhoDe?: (id: string, caminhoCanonico: string) => string }} [opts]
   */
  function montar(opts = {}) {
    const { omitir = null, duplicar = null, inverter = false, adulterarHashDe = null, caminhoDe = null } = opts;
    let ids = [...ORDEM_CANONICA];
    if (omitir) ids = ids.filter((id) => id !== omitir);
    if (inverter) ids = [...ids].reverse();
    if (duplicar) ids = [ids[0], ids[0], ...ids.slice(1)];

    let cumHash = GENESIS_HASH;
    const links = ids.map((id) => {
      const canonico = caminhos.find((c) => c.id === id);
      const rel = caminhoDe ? caminhoDe(id, canonico && canonico.path) : canonico.path;
      const abs = path.join(raiz, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (!fs.existsSync(abs)) fs.writeFileSync(abs, JSON.stringify({ elo: id }));
      const hash = sha256File(abs);
      const cumulativeHash = sha256String(`${cumHash}:${hash}`);
      cumHash = cumulativeHash;
      return {
        id,
        path: rel,
        exists: true,
        hash: adulterarHashDe === id ? 'f'.repeat(64) : hash,
        cumulativeHash,
        classe: 'DERIVADO',
        imutavelPosSelo: false,
      };
    });

    return { chainRoot: cumHash, chainLength: links.length, completeChain: true, missingLayers: [], links };
  }

  return {
    raiz,
    artifact,
    opcoes,
    caminhos,
    montar,
    abs: (rel) => path.join(raiz, rel),
    limpar: () => fs.rmSync(raiz, { recursive: true, force: true }),
  };
}

module.exports = { criarSandboxDeCadeia };
