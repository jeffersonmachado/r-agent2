import { useEffect, useRef, useState } from 'react';

/**
 * Deep link de documento RAG (`/rag-documents?documentId=…`).
 *
 * Origem: as fontes do Ask AI passaram a ser links para a rota interna de
 * documentos. Até esta fatia a página IGNORAVA o parâmetro e abria a lista, de
 * modo que o usuário clicava na fonte e não chegava ao documento citado.
 *
 * Regra de segurança (TAREFA 27): o parâmetro de URL é entrada NÃO CONFIÁVEL.
 * Ele identifica o documento, mas NUNCA autoriza. A leitura do documento passa
 * pela API, que aplica tenant e permissão; qualquer falha FECHA o caminho —
 * não abre a tela com dado não verificado, não cai para a lista, não tenta
 * outra origem.
 */

export const DEEP_LINK_PARAM = 'documentId';
export const DOCUMENT_ID_MAX_LENGTH = 256;

/**
 * Extrai o id de documento do search-string, ou `null` se ausente/inválido.
 * Rejeita vazio, excesso de tamanho, caracteres de controle e sequências de
 * travessia (`..`). O id continua sendo opaco: não é interpretado nem usado
 * para montar caminho aqui (`api/ragDocuments.getDocument` já codifica).
 *
 * @param {string} search  ex.: `?documentId=abc`
 * @returns {string|null}
 */
export function readDocumentId(search) {
  if (typeof search !== 'string' || search === '') return null;
  const raw = search.startsWith('?') ? search.slice(1) : search;
  let value;
  try {
    value = new URLSearchParams(raw).get(DEEP_LINK_PARAM);
  } catch (error) {
    return null;
  }
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.length > DOCUMENT_ID_MAX_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (trimmed.includes('..') || trimmed.includes('\\')) return null;
  return trimmed;
}

/**
 * Remove o parâmetro de deep link do search-string, preservando os demais.
 *
 * @param {string} search
 * @returns {string} `''` ou `'?a=b'`
 */
export function stripDocumentId(search) {
  if (typeof search !== 'string' || search === '') return '';
  const raw = search.startsWith('?') ? search.slice(1) : search;
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch (error) {
    return search;
  }
  if (!params.has(DEEP_LINK_PARAM)) return search;
  params.delete(DEEP_LINK_PARAM);
  const remaining = params.toString();
  return remaining ? `?${remaining}` : '';
}

export const DEEP_LINK_STATUS = {
  IDLE: 'idle',
  OPENING: 'opening',
  OPENED: 'opened',
  DENIED: 'denied',
  INVALID: 'invalid',
};

const HAS_DOCUMENT_ID = /(^|[?&])documentId=/;

/**
 * Traduz a falha da API em motivo para o usuário. Nenhum caso autoriza abrir o
 * documento: permissão negada, inexistente e falha de leitura apenas mudam a
 * mensagem — o caminho é fechado nos três.
 */
export function classifyDocumentAccessFailure(error) {
  const status = Number(error?.status ?? error?.response?.status ?? 0);
  if (status === 401 || status === 403) {
    return {
      code: 'access_denied',
      message: 'Você não tem permissão para abrir este documento.',
    };
  }
  if (status === 404) {
    return {
      code: 'document_not_found',
      message: 'Documento não encontrado neste espaço de trabalho.',
    };
  }
  return {
    code: 'load_failed',
    message: 'Não foi possível abrir o documento agora. Tente novamente.',
  };
}

function defaultApplySearch(search) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const { pathname, hash } = window.location;
  window.history.replaceState({}, '', `${pathname}${search}${hash || ''}`);
}

/**
 * Consome o deep link uma vez por documento: lê pela API
 * (a autorização continua sendo do servidor), abre pelo callback recebido e
 * normaliza a URL — o parâmetro sai da barra de endereço para não reabrir o
 * modal a cada fechamento ou re-render. Um segundo link, de outro documento,
 * continua funcionando.
 *
 * @param {object} options
 * @param {string} options.search         `window.location.search` da rota atual
 * @param {(id: string) => Promise<object>} options.loadDocument
 * @param {(doc: object) => void} [options.onOpen]
 * @param {(failure: {id: string, code: string, message: string, error: Error}) => void} [options.onDeny]
 * @param {(search: string) => void} [options.applySearch]
 */
export function useRagDocumentDeepLink({
  search,
  loadDocument,
  onOpen,
  onDeny,
  applySearch = defaultApplySearch,
} = {}) {
  const [state, setState] = useState({
    status: DEEP_LINK_STATUS.IDLE,
    code: null,
    message: null,
  });
  // Marca o que já foi consumido. Guarda o ID (e não um booleano) para que um
  // SEGUNDO link, de outro documento, continue funcionando na mesma sessão de
  // página — sem reabrir o mesmo documento a cada re-render.
  const consumedRef = useRef(null);
  const handlersRef = useRef({ loadDocument, onOpen, onDeny, applySearch });
  handlersRef.current = { loadDocument, onOpen, onDeny, applySearch };
  // Montagem do componente — NÃO o ciclo do efeito. O app roda sob
  // `React.StrictMode` (main.jsx:1195): em desenvolvimento o efeito monta,
  // roda o cleanup e monta de novo. Cancelar o carregamento no cleanup da
  // primeira execução descartava a resposta da API e a segunda execução via o
  // documento como já consumido — resultado: 200 na rede e tela parada.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const id = readDocumentId(search);
    const hasParam = typeof search === 'string' && HAS_DOCUMENT_ID.test(search);
    const marker = id || (hasParam ? `invalid:${search}` : null);
    if (!marker || consumedRef.current === marker) return;

    if (!id) {
      consumedRef.current = marker;
      setState({
        status: DEEP_LINK_STATUS.INVALID,
        code: 'invalid_document_id',
        message: 'Link de documento inválido.',
      });
      handlersRef.current.applySearch(stripDocumentId(search));
      return;
    }

    consumedRef.current = marker;
    const { loadDocument: load, onOpen: open, onDeny: deny, applySearch: apply } = handlersRef.current;

    setState({ status: DEEP_LINK_STATUS.OPENING, code: null, message: null });
    if (typeof apply === 'function') apply(stripDocumentId(search));

    Promise.resolve()
      .then(() => load(id))
      .then((doc) => {
        if (!mountedRef.current) return;
        if (!doc) {
          const failure = classifyDocumentAccessFailure({ status: 404 });
          setState({ status: DEEP_LINK_STATUS.DENIED, ...failure });
          if (typeof deny === 'function') deny({ id, ...failure });
          return;
        }
        setState({ status: DEEP_LINK_STATUS.OPENED, code: null, message: null });
        if (typeof open === 'function') open(doc);
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        const failure = classifyDocumentAccessFailure(error);
        setState({ status: DEEP_LINK_STATUS.DENIED, ...failure });
        if (typeof deny === 'function') deny({ id, ...failure, error });
      });
  }, [search]);

  return state;
}
