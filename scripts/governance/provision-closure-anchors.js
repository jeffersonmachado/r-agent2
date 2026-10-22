#!/usr/bin/env node
'use strict';

/**
 * provision-closure-anchors.js — provisiona/verifica as âncoras externas do Bug Closure First.
 *
 * POR QUE EXISTE
 * --------------
 * A blindagem do Bug Closure First exige três valores que NÃO podem morar no repositório,
 * porque tudo que está na árvore é reescrevível por quem tem write access a ela:
 *
 *   RAP_CLOSURE_TRUST_ANCHOR_SHA256    fingerprint (sha256 do SPKI) da chave que FECHA defeito
 *   RAP_APPROVAL_TRUST_ANCHOR_SHA256   fingerprint da chave que APROVA missão
 *   RAP_CLOSURE_INVENTORY_SHA256       digest canônico do inventário (id, severity, state)
 *
 * Este script NÃO guarda esses valores no repositório. Ele:
 *   - valida a chave pública informada e deriva o fingerprint;
 *   - calcula o digest do inventário OFICIAL;
 *   - imprime um bloco pronto para colar no cofre do orquestrador (CI secrets / vault);
 *   - grava, se pedido, um arquivo de ambiente FORA do workspace (`--out`), com permissão 600;
 *   - verifica (`--check`) se o ambiente corrente realmente tem âncoras válidas e coerentes
 *     com o inventário atual — preflight de release.
 *
 * ATENÇÃO OPERACIONAL
 * -------------------
 * `RAP_CLOSURE_INVENTORY_SHA256` muda SEMPRE que a fila muda legitimamente. Toda alteração
 * aprovada em `AI_MEMORY/hardening-queue.json` exige reprovisionar e atualizar o segredo —
 * esse é o preço de autenticar a pertença dos itens sem assinar o arquivo.
 *
 * Uso:
 *   node scripts/governance/provision-closure-anchors.js --key <chave-publica.pem> [--out <arquivo>]
 *   node scripts/governance/provision-closure-anchors.js --check
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const {
  fingerprintDaChavePem, digestDoInventario, ancoraExterna, ancoraDeAprovacao, ancoraDoInventario,
} = require(path.join(ROOT, 'governance', 'bug-closure', 'trusted-authorities'));

const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const flag = (nome) => process.argv.includes(nome);

function inventarioOficial() {
  const bruto = JSON.parse(fs.readFileSync(path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json'), 'utf8'));
  const itens = Array.isArray(bruto.items) ? bruto.items : [];
  return { itens, digest: digestDoInventario(itens) };
}

function provisionar() {
  const caminhoChave = arg('--key');
  if (!caminhoChave) {
    process.stderr.write('[ancoras] uso: --key <chave-publica.pem> | --check\n');
    return 2;
  }
  const pem = fs.readFileSync(caminhoChave, 'utf8');
  const fingerprint = fingerprintDaChavePem(pem);
  if (!fingerprint) {
    process.stderr.write('[ancoras] RECUSADO: a chave informada não é uma chave pública PEM válida\n');
    return 2;
  }
  const { itens, digest } = inventarioOficial();

  const bloco = [
    `RAP_CLOSURE_TRUST_ANCHOR_SHA256=${fingerprint}`,
    `RAP_APPROVAL_TRUST_ANCHOR_SHA256=${fingerprint}`,
    `RAP_CLOSURE_INVENTORY_SHA256=${digest}`,
  ];

  process.stdout.write('# Bloco para o COFRE do orquestrador (NUNCA versionar):\n');
  process.stdout.write(`${bloco.join('\n')}\n`);
  process.stdout.write(`# inventário: ${itens.length} itens · digest ${digest.slice(0, 12)}…\n`);
  process.stdout.write('# PIN a registrar em governance/bug-closure/trusted-authorities.js:\n');
  process.stdout.write(`#   PINNED_AUTHORITY_FINGERPRINTS = ['${fingerprint}']\n`);
  process.stdout.write('# (o PIN sozinho não autoriza nada: a âncora externa acima é obrigatória)\n');

  const destino = arg('--out');
  if (destino) {
    const abs = path.resolve(destino);
    const dentroDoRepo = abs.startsWith(`${path.resolve(ROOT)}${path.sep}`);
    if (dentroDoRepo) {
      process.stderr.write(`[ancoras] RECUSADO: --out dentro do repositório (${abs}). `
        + 'Âncora versionada deixa de ser âncora.\n');
      return 2;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${bloco.join('\n')}\n`, { mode: 0o600 });
    process.stdout.write(`[ancoras] gravado em ${abs} (modo 600, fora do workspace)\n`);
  } else {
    process.stdout.write(`# Dica: --out ${path.join(os.homedir(), '.config', 'ragent2', 'closure-anchors.env')}\n`);
  }
  return 0;
}

function verificar() {
  const { itens, digest } = inventarioOficial();
  const achados = [];
  const chave = ancoraExterna();
  const aprovacao = ancoraDeAprovacao();
  const inventario = ancoraDoInventario();

  if (!chave) achados.push('RAP_CLOSURE_TRUST_ANCHOR_SHA256 ausente/inválida — nenhuma prova de fechamento será aceita');
  if (!aprovacao) achados.push('RAP_APPROVAL_TRUST_ANCHOR_SHA256 ausente/inválida — aprovação humana não conta');
  if (!inventario) achados.push('RAP_CLOSURE_INVENTORY_SHA256 ausente/inválida — operação certificante será negada');
  if (inventario && inventario !== digest) {
    achados.push(`RAP_CLOSURE_INVENTORY_SHA256 (${inventario.slice(0, 12)}…) != digest atual (${digest.slice(0, 12)}…) — a fila mudou desde o provisionamento; reprovisione e atualize o segredo`);
  }

  const ok = achados.length === 0;
  const saida = {
    kind: 'closure-anchors-check',
    generatedAt: new Date().toISOString(),
    ok,
    authoritative: false,
    inventario: { itens: itens.length, digest },
    ancoras: {
      fechamento: chave ? `${chave.slice(0, 12)}…` : null,
      aprovacao: aprovacao ? `${aprovacao.slice(0, 12)}…` : null,
      inventario: inventario ? `${inventario.slice(0, 12)}…` : null,
    },
    achados,
  };
  process.stdout.write(`${JSON.stringify(saida, null, 2)}\n`);
  return ok ? 0 : 1;
}

process.exitCode = flag('--check') ? verificar() : provisionar();
