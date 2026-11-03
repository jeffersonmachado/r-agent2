'use strict';

/**
 * defect-id.js — CONTRATO CANÔNICO de identificador de defeito e resolução SEGURA de destino.
 *
 * POR QUE EXISTE (P1-A)
 * ---------------------
 * O regularizador histórico monta caminhos com o `defectId` vindo da fila
 * (`${defectId}.log`, `${item.id}.json`, `itens/${r.id}.json`). Um identificador com `../`
 * produz escrita FORA da raiz autorizada — reproduzido com filesystem real: o id
 * `../../../../../tmp/p1a-fora-2` criou `/tmp/p1a-fora-2.log`.
 *
 * A correção é na ORIGEM, não no último `writeFileSync`:
 *   1. contrato explícito do identificador (allowlist de caracteres, tamanho, sem `..`);
 *   2. validação do CONJUNTO antes de qualquer efeito (colisão em filesystem case-insensitive,
 *      ids conflitantes por normalização);
 *   3. resolução do destino com contenção verificada por `realpath` da raiz EXISTENTE (symlink
 *      de diretório não escapa);
 *   4. gravação com `O_NOFOLLOW` + temporário no MESMO diretório verificado + `rename`, para não
 *      seguir symlink e não deixar arquivo parcial (TOCTOU entre validar e abrir).
 *
 * Compatibilidade: os identificadores históricos da fila (`P0-1`, `AUDITORIA-ENTRYPOINT-TRAVAS`,
 * `HARDENING-ENG-GOV-RELEASE-TAXONOMIA-PERSISTENCIA-AI-MEMORY-EVIDENCE`, `N5-REENTREGA`, ...)
 * continuam válidos — o contrato é uma allowlist, não uma mudança de formato.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Tamanho máximo de um identificador (os maiores da fila têm ~70 caracteres). */
const TAMANHO_MAXIMO = 120;

/**
 * Allowlist de caracteres: ASCII alfanumérico mais `.`, `_` e `-`.
 * Primeiro caractere é alfanumérico; último também (sem `-`/`.`/`_` no fim).
 * `.` isolado é aceito (ids como `V1.2-CORRIGIDO`), `..` nunca.
 */
const PADRAO = /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/;

/** Nomes reservados no Windows: um id que vira arquivo não pode ser um deles. */
const RESERVADOS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Valida UM identificador.
 * @returns {{ok:true, id:string}|{ok:false, motivo:string}}
 */
function validarId(valor) {
  if (typeof valor !== 'string') return { ok: false, motivo: 'ID_NAO_STRING' };
  if (valor.length === 0) return { ok: false, motivo: 'ID_VAZIO' };
  if (valor !== valor.trim()) return { ok: false, motivo: 'ID_COM_ESPACO_NAS_BORDAS' };
  if (valor.length > TAMANHO_MAXIMO) return { ok: false, motivo: 'ID_LONGO_DEMAIS' };
  // Controle, NUL e qualquer não-ASCII (Unicode ambíguo/homoglifo) ficam de fora da allowlist.
  for (const ch of valor) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp === 0x7f) return { ok: false, motivo: 'ID_COM_CARACTERE_DE_CONTROLE' };
    if (cp > 0x7f) return { ok: false, motivo: 'ID_NAO_ASCII' };
  }
  if (!PADRAO.test(valor)) return { ok: false, motivo: 'ID_FORA_DO_CONTRATO' };
  if (valor.includes('..')) return { ok: false, motivo: 'ID_COM_TRAVERSAL' };
  if (valor.includes('/') || valor.includes('\\')) return { ok: false, motivo: 'ID_COM_SEPARADOR_DE_CAMINHO' };
  if (valor.startsWith('.')) return { ok: false, motivo: 'ID_COM_INICIO_DE_OCULTO' };
  if (path.isAbsolute(valor)) return { ok: false, motivo: 'ID_ABSOLUTO' };
  if (RESERVADOS.has(valor.toLowerCase().split('.')[0])) return { ok: false, motivo: 'ID_RESERVADO_NO_FILESYSTEM' };
  return { ok: true, id: valor };
}

/**
 * Valida um CONJUNTO de identificadores antes de qualquer escrita.
 *
 * Dois ids diferentes que normalizam para o mesmo nome de arquivo colidiriam entre si
 * (filesystem case-insensitive, ou `A.B` vs `A-B` em alguma etapa de sanitização): isso é
 * rejeitado, não "o último vence".
 *
 * @returns {{ok:boolean, invalidos:Array<{id:*,motivo:string}>, colisoes:Array<{normalizado:string, ids:string[]}>}}
 */
function validarConjunto(ids) {
  const invalidos = [];
  const porNormalizado = new Map();
  for (const bruto of Array.isArray(ids) ? ids : []) {
    const v = validarId(bruto);
    if (!v.ok) {
      invalidos.push({ id: bruto, motivo: v.motivo });
      continue;
    }
    const normalizado = v.id.toLowerCase();
    if (!porNormalizado.has(normalizado)) porNormalizado.set(normalizado, []);
    porNormalizado.get(normalizado).push(v.id);
  }
  const colisoes = [];
  for (const [normalizado, lista] of porNormalizado) {
    if (new Set(lista).size > 1) colisoes.push({ normalizado, ids: [...new Set(lista)] });
  }
  return { ok: invalidos.length === 0 && colisoes.length === 0, invalidos, colisoes };
}

/**
 * `realpath` do ancestral EXISTENTE mais próximo de `abs` (o destino pode ainda não existir).
 * É o que impede escape por symlink de diretório no meio do caminho.
 */
function ancestralReal(abs) {
  let atual = path.resolve(abs);
  for (;;) {
    try {
      return fs.realpathSync(atual);
    } catch (_) {
      const pai = path.dirname(atual);
      if (pai === atual) return path.resolve(atual);
      atual = pai;
    }
  }
}

/** O caminho resolvido está contido na raiz resolvida? */
function dentroDaRaiz(abs, raizAbs) {
  const raiz = ancestralReal(raizAbs);
  const alvo = path.join(ancestralReal(path.dirname(abs)), path.basename(abs));
  return alvo === raiz || alvo.startsWith(`${raiz}${path.sep}`);
}

/**
 * Resolve `<rootDir>/<dirRel>/<id><ext>` com contrato + contenção verificados.
 *
 * @param {{rootDir:string, dirRel:string, id:string, ext:string}} entrada
 * @returns {{ok:true, abs:string, rel:string}|{ok:false, motivo:string}}
 */
function resolverDestino({ rootDir, dirRel, id, ext = '.json' }) {
  const v = validarId(id);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  if (typeof dirRel !== 'string' || dirRel === '' || path.isAbsolute(dirRel)) return { ok: false, motivo: 'DIR_REL_INVALIDO' };
  if (dirRel.split(/[\\/]/).includes('..')) return { ok: false, motivo: 'DIR_REL_COM_TRAVERSAL' };
  if (!/^\.[A-Za-z0-9]+$/.test(String(ext))) return { ok: false, motivo: 'EXTENSAO_INVALIDA' };

  const dirAbs = path.join(rootDir, dirRel);
  const abs = path.join(dirAbs, `${v.id}${ext}`);
  if (!dentroDaRaiz(dirAbs, rootDir)) return { ok: false, motivo: 'DIR_FORA_DA_RAIZ' };
  if (!dentroDaRaiz(abs, rootDir)) return { ok: false, motivo: 'DESTINO_FORA_DA_RAIZ' };
  return { ok: true, abs, rel: path.relative(rootDir, abs) };
}

/**
 * Grava `conteudo` em `abs` sem seguir symlink e sem deixar arquivo parcial.
 *
 * `O_NOFOLLOW` no alvo + temporário imprevisível no MESMO diretório + `rename` atômico:
 *   - symlink no destino ⇒ `ELOOP` (recusa), nunca escreve no alvo do link;
 *   - falha no meio ⇒ o temporário é removido, o destino antigo permanece íntegro;
 *   - o `rename` substitui a ENTRADA de diretório (não o alvo de um link).
 */
function gravarSemSeguirSymlink(abs, conteudo) {
  const dir = path.dirname(abs);
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (st && st.isSymbolicLink()) return { ok: false, motivo: 'DESTINO_E_SYMLINK' };
  if (st && !st.isFile()) return { ok: false, motivo: 'DESTINO_NAO_E_ARQUIVO' };
  const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const carga = Buffer.from(String(conteudo), 'utf8');
      const escritos = fs.writeSync(fd, carga);
      if (escritos !== carga.length) throw new Error(`escrita parcial ${escritos}/${carga.length}`);
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch (_) { /* já fechado */ }
    }
    fs.renameSync(tmp, abs);
    return { ok: true, abs };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nada a limpar */ }
    return { ok: false, motivo: `ESCRITA_FALHOU:${e.code || e.message}` };
  }
}

module.exports = {
  TAMANHO_MAXIMO,
  PADRAO,
  validarId,
  validarConjunto,
  resolverDestino,
  gravarSemSeguirSymlink,
  dentroDaRaiz,
  ancestralReal,
};
