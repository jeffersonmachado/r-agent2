'use strict';

/**
 * Regras de DETECÇÃO da jornada funcional em browser — puras e testáveis.
 *
 * DEFEITO QUE MOTIVA (medido 2026-10-17, rodando a jornada real): o detector
 * produziu DOIS defeitos que não existiam e, ao corrigi-los, revelou um terceiro
 * falso positivo. Todos eram regras do próprio detector, não da tela:
 *
 *  1. `/editor` acusava "tela vazia (13 chars)" porque o estado `Carregando...`
 *     era estável por dois ciclos — estabilizar não é o mesmo que terminar.
 *  2. `/tasks` escolhia o chip **"Atualizar"** (botão de AÇÃO) como se fosse
 *     filtro; a lista estava vazia e o efeito saía `undefined -> undefined`.
 *  3. `/crm` acusava erro de console porque o smoke RECARREGA a rota entre as
 *     ações e o `fetch` em voo é cancelado pela navegação ("Failed to fetch").
 *
 * Um detector que inventa defeito é tão perigoso quanto um que os esconde: ele
 * treina quem lê a ignorar o vermelho. As regras ficam aqui, com prova executável.
 */

/** Marcador de carregamento: estabilidade dele NÃO significa conteúdo pronto. */
const MARCADOR_DE_CARREGAMENTO = /^(carregando|loading|aguarde|processando|inicializando)[\s.…!]*$/i;

/** Texto de cancelamento de request (navegação/unmount), não de falha de produto. */
const PADRAO_CANCELAMENTO = /Failed to fetch|Load failed|AbortError|signal is aborted|The user aborted a request/i;

/** Grupos de menu lateral e rótulos de usuário (também são `<button>`). */
const DO_MENU = /recolher menu|atalhos|super admin|\bsa \d|atendimento|canais|modelagem|execu|assistentes|monitoramento|an[aá]lises|administra|governan|suporte da|relacionamento|construtor|espa[çc]o de trabalho|^crm$|^conhecimento$|^dev$|^admin$|^ops$/i;

/** Verbo de AÇÃO: clicar não filtra, então não serve como chip de filtro. */
const DE_ACAO = /^(atualizar|atualiza|novo|nova|criar|criando|salvar|buscar|procurar|exportar|importar|gerar|adicionar|editar|excluir|remover|deletar|enviar|cancelar|fechar|abrir|carregar|aplicar|limpar|filtrar|perguntar|template|mais|⋯|voltar|sair|entrar|tentar|recarregar)\b/i;

/**
 * Escolhe um chip de FILTRO entre os rótulos visíveis.
 * @returns {string|null} rótulo do chip, ou null quando não há filtro identificável
 */
function selecionarChipDeFiltro(chips) {
  const lista = Array.isArray(chips) ? chips : [];
  const candidato = lista.find((t) => typeof t === 'string'
    && !DO_MENU.test(t)
    && !DE_ACAO.test(t)
    && !/^\d+$/.test(t)
    && !/^[<>‹›←→]/.test(t)
    && t.length <= 20);
  return candidato || null;
}

/**
 * Classifica uma mensagem de console.
 * @param {{texto:string, emNavegacao?:boolean}} entrada
 * @returns {'DEFEITO'|'CANCELAMENTO_DECLARADO'}
 */
function classificarErroDeConsole({ texto, emNavegacao } = {}) {
  const t = String(texto || '');
  if (emNavegacao === true && PADRAO_CANCELAMENTO.test(t)) return 'CANCELAMENTO_DECLARADO';
  return 'DEFEITO';
}

/**
 * Estado da espera de estabilidade — loading não encerra a espera.
 * @param {{anterior:number, estaveis:number, extras:number}} estado
 * @param {{texto:string, extrasAposLoading?:number, maxTentativas?:number}} leitura
 * @returns {{estado:Object, concluido:boolean, chars:number}}
 */
function proximaLeituraDeEstabilidade(estado, { texto, extrasAposLoading = 12, maxTentativas = 14 } = {}) {
  const anterior = typeof estado === 'object' && estado !== null ? estado : {};
  const textoAtual = String(texto || '').replace(/\s+/g, ' ').trim();
  const chars = textoAtual.length;
  const carregando = MARCADOR_DE_CARREGAMENTO.test(textoAtual);
  const tentativas = Number(anterior.tentativas || 0) + 1;
  const estaveis = chars > 0 && chars === anterior.anterior ? Number(anterior.estaveis || 0) + 1 : 0;
  let extras = Number(anterior.extras || 0);

  if (estaveis > 0) {
    if (carregando && extras < extrasAposLoading) {
      extras += 1;
      return { estado: { anterior: chars, estaveis, extras, tentativas }, concluido: false, chars };
    }
    return { estado: { anterior: chars, estaveis, extras, tentativas }, concluido: true, chars };
  }
  const concluido = tentativas >= maxTentativas;
  return { estado: { anterior: chars, estaveis, extras, tentativas }, concluido, chars };
}

module.exports = {
  MARCADOR_DE_CARREGAMENTO,
  PADRAO_CANCELAMENTO,
  selecionarChipDeFiltro,
  classificarErroDeConsole,
  proximaLeituraDeEstabilidade,
};
