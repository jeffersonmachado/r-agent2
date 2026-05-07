import type { Page, WebSocket } from '@playwright/test';

/**
 * Protocolo WebSocket do backend:
 *   conectado  → cliente envia: { type: 'auth', token }
 *   autenticado → servidor responde: { type: 'auth', status: 'success', agent: {...} }
 *   subscrição → cliente envia: { type: 'subscribe', events: string[] }
 *   evento     → servidor envia: { type: 'event', event: string, data: object, timestamp: string }
 *   ping/pong  → { type: 'ping' } / { type: 'pong' }
 */

export interface WsFrame {
  direction: 'sent' | 'received';
  raw: string;
  parsed: Record<string, unknown> | null;
  at: number; // epoch ms
}

export interface WsMonitorResult {
  data: Record<string, unknown>;
  frames: WsFrame[];
  durationMs: number;
}

/**
 * Instala monitor WS na page e aguarda um evento específico com diagnóstico granular.
 *
 * Falhas reportadas com contexto completo:
 *   - WS nunca conectou
 *   - WS conectou mas auth nunca recebida
 *   - WS autenticado mas subscrição não enviada para o evento
 *   - Evento recebido mas predicate nunca satisfeito
 *   - Timeout geral com contagem de cada fase
 *
 * @param page       Instância Playwright Page
 * @param eventName  Nome do evento backend (ex: 'qa-waves.execution.updated')
 * @param predicate  Filtra payload — se retornar false o evento é ignorado
 * @param timeoutMs  Timeout total em ms (padrão: 180 000)
 */
export async function waitForWsEvent(
  page: Page,
  eventName: string,
  predicate?: (data: Record<string, unknown>) => boolean,
  timeoutMs = 180_000,
): Promise<WsMonitorResult> {
  const startAt = Date.now();
  const allFrames: WsFrame[] = [];

  // Diagnóstico de fases
  let wsConnected = false;
  let wsAuthSent = false;
  let wsAuthOk = false;
  let wsSubscribeSent = false;
  let eventsReceived = 0;
  let eventsMatchedEvent = 0;
  let eventsFailedPredicate = 0;

  return new Promise<WsMonitorResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      const elapsed = Date.now() - startAt;
      const lines: string[] = [
        `[WsMonitor] Timeout após ${elapsed}ms aguardando evento "${eventName}"`,
        `  WS conectou:         ${wsConnected}`,
        `  Auth enviada:        ${wsAuthSent}`,
        `  Auth confirmada:     ${wsAuthOk}`,
        `  Subscribe enviado:   ${wsSubscribeSent} (para "${eventName}")`,
        `  Frames recebidos:    ${allFrames.filter(f => f.direction === 'received').length}`,
        `  Frames enviados:     ${allFrames.filter(f => f.direction === 'sent').length}`,
        `  Eventos totais:      ${eventsReceived}`,
        `  Eventos tipo certo:  ${eventsMatchedEvent}`,
        `  Predicate falhou:    ${eventsFailedPredicate}×`,
      ];

      if (!wsConnected) {
        lines.push('  CAUSA PROVÁVEL: WebSocket nunca estabeleceu conexão com o backend.');
      } else if (!wsAuthOk) {
        lines.push('  CAUSA PROVÁVEL: Auth WS falhou ou token inválido/expirado.');
      } else if (!wsSubscribeSent) {
        lines.push(`  CAUSA PROVÁVEL: Frontend não enviou subscribe para "${eventName}".`);
      } else if (eventsMatchedEvent === 0) {
        lines.push(`  CAUSA PROVÁVEL: Backend não emitiu "${eventName}" no tenant/execução correto.`);
      } else if (eventsFailedPredicate > 0) {
        lines.push(`  CAUSA PROVÁVEL: Evento recebido ${eventsMatchedEvent}× mas predicate rejeitou todas as ocorrências.`);
        const lastMatch = allFrames
          .filter(f => f.direction === 'received' && f.parsed?.event === eventName)
          .slice(-1)[0];
        if (lastMatch) {
          lines.push(`  Último payload recebido: ${JSON.stringify(lastMatch.parsed?.data ?? lastMatch.parsed, null, 2)}`);
        }
      }

      reject(new Error(lines.join('\n')));
    }, timeoutMs);

    function trackWs(ws: WebSocket): void {
      wsConnected = true;

      ws.on('framesent', ({ payload }) => {
        const raw = typeof payload === 'string' ? payload : payload.toString();
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(raw); } catch { /* binary frame */ }

        allFrames.push({ direction: 'sent', raw, parsed, at: Date.now() });

        if (parsed?.type === 'auth') wsAuthSent = true;
        if (parsed?.type === 'subscribe') {
          const events = parsed.events as string[] | undefined;
          if (Array.isArray(events) && events.includes(eventName)) {
            wsSubscribeSent = true;
          }
        }
      });

      ws.on('framereceived', ({ payload }) => {
        const raw = typeof payload === 'string' ? payload : payload.toString();
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(raw); } catch { /* binary frame */ }

        allFrames.push({ direction: 'received', raw, parsed, at: Date.now() });

        if (!parsed) return;

        if (parsed.type === 'auth') {
          if (parsed.status === 'success') wsAuthOk = true;
          if (parsed.status !== 'success') {
            clearTimeout(timer);
            reject(new Error(
              `[WsMonitor] Auth WS falhou antes de receber "${eventName}".\n` +
              `  Resposta auth: ${JSON.stringify(parsed)}\n` +
              `  Verifique se o token JWT é válido e o usuário tem permissão.`,
            ));
          }
          return;
        }

        if (parsed.type !== 'event') return;
        eventsReceived++;

        if (parsed.event !== eventName) return;
        eventsMatchedEvent++;

        const data = (parsed.data ?? {}) as Record<string, unknown>;
        if (predicate && !predicate(data)) {
          eventsFailedPredicate++;
          return;
        }

        clearTimeout(timer);
        resolve({
          data,
          frames: allFrames,
          durationMs: Date.now() - startAt,
        });
      });

      ws.on('close', () => {
        // WS fechou — registrar para diagnóstico mas não rejeitar ainda (pode reconectar)
        allFrames.push({
          direction: 'received',
          raw: '[ws:close]',
          parsed: { type: 'ws:close' },
          at: Date.now(),
        });
      });
    }

    // Captura conexões WS abertas agora e futuras (reconexões, lazy-connect)
    page.on('websocket', trackWs);
  });
}
