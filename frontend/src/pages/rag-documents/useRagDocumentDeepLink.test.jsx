import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import {
  DEEP_LINK_PARAM,
  DOCUMENT_ID_MAX_LENGTH,
  readDocumentId,
  stripDocumentId,
  useRagDocumentDeepLink,
} from './useRagDocumentDeepLink';

/**
 * Defeito provado (2026-09-14): a rota `/rag-documents?documentId=…` ignorava o
 * parâmetro. As fontes do Ask AI apontam para essa rota, então clicar na fonte
 * levava à LISTA, não ao documento citado. Ao mesmo tempo, ler o id da URL sem
 * passar pela autorização abriria caminho para ver documento de outro tenant.
 *
 * Estes testes exigem as duas coisas: o link ABRE o documento, e toda falha de
 * leitura (permissão/tenant/inexistente/erro) FECHA o caminho em vez de abrir a
 * tela com dado não verificado.
 */

describe('readDocumentId / stripDocumentId', () => {
  it('lê o id codificado e devolve decodificado', () => {
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=src-docs-manual-verticals-beauty`))
      .toBe('src-docs-manual-verticals-beauty');
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=a%2Fb`)).toBe('a/b');
  });

  it('ignora ausência, vazio e outros parâmetros', () => {
    expect(readDocumentId('')).toBeNull();
    expect(readDocumentId('?foo=1')).toBeNull();
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=`)).toBeNull();
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=%20%20`)).toBeNull();
  });

  it('rejeita entrada não confiável: controle, travessia e excesso', () => {
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=a%00b`)).toBeNull();
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=..%2F..%2Fetc%2Fpasswd`)).toBeNull();
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=a%5Cb`)).toBeNull();
    expect(readDocumentId(`?${DEEP_LINK_PARAM}=${'x'.repeat(DOCUMENT_ID_MAX_LENGTH + 1)}`)).toBeNull();
  });

  it('remove apenas o parâmetro de documento', () => {
    expect(stripDocumentId(`?${DEEP_LINK_PARAM}=abc&tab=chunks`)).toBe('?tab=chunks');
    expect(stripDocumentId(`?${DEEP_LINK_PARAM}=abc`)).toBe('');
    expect(stripDocumentId('?tab=chunks')).toBe('?tab=chunks');
  });
});

describe('useRagDocumentDeepLink', () => {
  let loadDocument;
  let onOpen;
  let onDeny;
  let applySearch;

  const mount = (search) => renderHook(() => useRagDocumentDeepLink({
    search,
    loadDocument,
    onOpen,
    onDeny,
    applySearch,
  }));

  beforeEach(() => {
    loadDocument = vi.fn();
    onOpen = vi.fn();
    onDeny = vi.fn();
    applySearch = vi.fn();
  });

  it('sem parâmetro não carrega nada e não nega nada', async () => {
    const { result } = mount('?tab=chunks');
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(loadDocument).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(applySearch).not.toHaveBeenCalled();
  });

  it('com id válido carrega pela API e entrega o documento', async () => {
    const doc = { id: 'abc', title: 'Manual' };
    loadDocument.mockResolvedValue(doc);
    const { result } = mount(`?${DEEP_LINK_PARAM}=abc`);

    await waitFor(() => expect(result.current.status).toBe('opened'));
    expect(loadDocument).toHaveBeenCalledWith('abc');
    expect(onOpen).toHaveBeenCalledWith(doc);
    expect(onDeny).not.toHaveBeenCalled();
    expect(result.current.code).toBeNull();
  });

  it('id inválido não chama a API e não abre nada', async () => {
    const { result } = mount(`?${DEEP_LINK_PARAM}=..%2Fx`);
    await waitFor(() => expect(result.current.status).toBe('invalid'));
    expect(loadDocument).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it('permissão negada FECHA o caminho (não abre, avisa o usuário)', async () => {
    const error = Object.assign(new Error('forbidden'), { status: 403 });
    loadDocument.mockRejectedValue(error);
    const { result } = mount(`?${DEEP_LINK_PARAM}=abc`);

    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(result.current.code).toBe('access_denied');
    expect(result.current.message).toMatch(/permiss/i);
  });

  it('documento inexistente também fecha o caminho com motivo próprio', async () => {
    loadDocument.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const { result } = mount(`?${DEEP_LINK_PARAM}=abc`);

    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(result.current.code).toBe('document_not_found');
  });

  it('falha de rede é distinguida de negação', async () => {
    loadDocument.mockRejectedValue(new Error('network down'));
    const { result } = mount(`?${DEEP_LINK_PARAM}=abc`);

    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(result.current.code).toBe('load_failed');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('consome o parâmetro uma única vez (não reabre ao fechar)', async () => {
    loadDocument.mockResolvedValue({ id: 'abc' });
    const { rerender } = renderHook(
      ({ search }) => useRagDocumentDeepLink({ search, loadDocument, onOpen, onDeny, applySearch }),
      { initialProps: { search: `?${DEEP_LINK_PARAM}=abc` } },
    );

    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    // A URL é normalizada ao consumir: o parâmetro sai.
    expect(applySearch).toHaveBeenCalledWith('');

    rerender({ search: '' });
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(loadDocument).toHaveBeenCalledTimes(1);
  });

  it('sobrevive ao efeito duplo do StrictMode (o app real roda sob StrictMode)', async () => {
    // main.jsx:1195 envolve a aplicação em React.StrictMode. Em desenvolvimento
    // os efeitos montam, passam por cleanup e montam de novo. A primeira versão
    // cancelava o carregamento no cleanup e a segunda execução via o documento
    // como já consumido — o link era lido, a API respondia 200 e NADA abria.
    loadDocument.mockResolvedValue({ id: 'abc' });
    renderHook(
      () => useRagDocumentDeepLink({
        search: `?${DEEP_LINK_PARAM}=abc`,
        loadDocument,
        onOpen,
        onDeny,
        applySearch,
      }),
      { wrapper: React.StrictMode },
    );

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ id: 'abc' }));
    expect(loadDocument).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
  });

  it('em StrictMode a negação também chega (não é engolida pelo cleanup)', async () => {
    loadDocument.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    renderHook(
      () => useRagDocumentDeepLink({
        search: `?${DEEP_LINK_PARAM}=abc`,
        loadDocument,
        onOpen,
        onDeny,
        applySearch,
      }),
      { wrapper: React.StrictMode },
    );

    await waitFor(() => expect(onDeny).toHaveBeenCalledTimes(1));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('um segundo link, de outro documento, também abre', async () => {
    loadDocument.mockImplementation((id) => Promise.resolve({ id }));
    const { rerender } = renderHook(
      ({ search }) => useRagDocumentDeepLink({ search, loadDocument, onOpen, onDeny, applySearch }),
      { initialProps: { search: `?${DEEP_LINK_PARAM}=primeiro` } },
    );

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ id: 'primeiro' }));
    rerender({ search: `?${DEEP_LINK_PARAM}=segundo` });

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ id: 'segundo' }));
    expect(loadDocument).toHaveBeenCalledTimes(2);
  });

  it('ao negar também normaliza a URL, sem reabrir em re-render', async () => {
    loadDocument.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    const { rerender } = renderHook(
      ({ search }) => useRagDocumentDeepLink({ search, loadDocument, onOpen, onDeny, applySearch }),
      { initialProps: { search: `?${DEEP_LINK_PARAM}=abc` } },
    );

    await waitFor(() => expect(onDeny).toHaveBeenCalledTimes(1));
    expect(applySearch).toHaveBeenCalledWith('');
    rerender({ search: '' });
    await waitFor(() => expect(onDeny).toHaveBeenCalledTimes(1));
  });

  it('preserva outros parâmetros ao normalizar a URL', async () => {
    loadDocument.mockResolvedValue({ id: 'abc' });
    mount(`?tab=chunks&${DEEP_LINK_PARAM}=abc`);
    await waitFor(() => expect(applySearch).toHaveBeenCalledWith('?tab=chunks'));
  });
});
