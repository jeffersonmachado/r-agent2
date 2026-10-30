/**
 * useLroStream — consome o stream de eventos de uma operação longa (LRO).
 *
 * Por que `fetch` e não `EventSource`: `EventSource` não permite cabeçalhos, e a rota
 * `/api/lro/:id/events` exige `Authorization`. Colocar token na query string vazaria credencial em
 * log/proxy — inaceitável. Com `fetch` + ReadableStream o header é enviado e o cursor
 * (`Last-Event-ID`) também vai como cabeçalho no reconnect.
 *
 * Contratos que este hook garante (mandato LRO §6):
 *  - progresso é PROGRESSIVO: cada evento chama `onEvent` assim que chega (não espera o fim);
 *  - reconexão usa o ÚLTIMO `seq` recebido (`after`), então não há lacuna nem repetição;
 *  - `state` expõe `connecting|open|reconnecting|closed` para a UI mostrar a verdade;
 *  - fechar o navegador NÃO interrompe a operação: quem executa é o servidor; ao voltar, o replay
 *    reidrata o que faltou.
 */

import { useEffect, useRef, useState } from 'react';

const ESTADOS = Object.freeze({
  CONNECTING: 'connecting',
  OPEN: 'open',
  RECONNECTING: 'reconnecting',
  CLOSED: 'closed',
});

function parsearBloco(bloco) {
  const evento = { id: null, event: 'message', data: null };
  for (const linha of String(bloco).split('\n')) {
    if (linha.startsWith('id:')) evento.id = Number(linha.slice(3).trim());
    else if (linha.startsWith('event:')) evento.event = linha.slice(6).trim();
    else if (linha.startsWith('data:')) evento.data = linha.slice(5).trim();
  }
  if (!evento.data) return null;
  let payload = null;
  try { payload = JSON.parse(evento.data); } catch (_) { payload = null; }
  return { seq: Number.isFinite(evento.id) ? evento.id : null, type: evento.event, payload };
}

export function useLroStream({
  operationId,
  baseUrl = '',
  token = null,
  tenantId = null,
  enabled = true,
  onEvent = null,
  maxReconexoes = 5,
} = {}) {
  const [state, setState] = useState(ESTADOS.CLOSED);
  const [lastSeq, setLastSeq] = useState(0);
  const [events, setEvents] = useState([]);
  const cursorRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !operationId) return undefined;

    let cancelado = false;
    let controlador = null;
    let reconexoes = 0;

    const aplicar = (evento) => {
      if (!evento) return;
      if (evento.seq !== null) {
        if (evento.seq <= cursorRef.current) return; // replay não duplica
        cursorRef.current = evento.seq;
        setLastSeq(evento.seq);
      }
      setEvents((anteriores) => [...anteriores, evento]);
      if (onEventRef.current) onEventRef.current(evento);
    };

    const consumir = async (texto) => {
      const partes = String(texto).split('\n\n');
      for (const parte of partes) {
        if (!parte.trim()) continue;
        aplicar(parsearBloco(parte));
      }
    };

    const conectar = async () => {
      if (cancelado) return;
      controlador = new AbortController();
      setState(cursorRef.current === 0 ? ESTADOS.CONNECTING : ESTADOS.RECONNECTING);

      try {
        const resposta = await fetch(`${baseUrl}/api/lro/${encodeURIComponent(operationId)}/events`, {
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {}),
            ...(cursorRef.current > 0 ? { 'Last-Event-ID': String(cursorRef.current) } : {}),
          },
          signal: controlador.signal,
        });

        if (!resposta.ok || !resposta.body) {
          throw new Error(`lro_stream_http_${resposta.status}`);
        }
        setState(ESTADOS.OPEN);

        const leitor = resposta.body.getReader();
        const decodificador = new TextDecoder();
        let acumulado = '';
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          acumulado += decodificador.decode(value, { stream: true });
          const corte = acumulado.lastIndexOf('\n\n');
          if (corte >= 0) {
            const pronto = acumulado.slice(0, corte + 2);
            acumulado = acumulado.slice(corte + 2);
            await consumir(pronto);
          }
        }

        // Stream terminou (operação terminal ou snapshot): se não foi cancelado, tenta retomar.
        if (!cancelado) throw new Error('lro_stream_encerrado');
      } catch (error) {
        if (cancelado || (error && error.name === 'AbortError')) return;
        reconexoes += 1;
        if (reconexoes > maxReconexoes) {
          setState(ESTADOS.CLOSED);
          return;
        }
        setState(ESTADOS.RECONNECTING);
        const espera = Math.min(1000 * Math.pow(2, reconexoes - 1), 8000);
        setTimeout(conectar, espera);
      }
    };

    conectar();

    return () => {
      cancelado = true;
      if (controlador) controlador.abort();
      setState(ESTADOS.CLOSED);
    };
  }, [operationId, baseUrl, token, tenantId, enabled, maxReconexoes]);

  return { state, lastSeq, events, ESTADOS };
}

export { ESTADOS };
export default useLroStream;
