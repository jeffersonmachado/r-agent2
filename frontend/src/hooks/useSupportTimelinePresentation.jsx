import React, { useCallback } from 'react';

function redactSensitiveText(text) {
  return String(text || '')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, 'CPF oculto')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, 'CNPJ oculto')
    .replace(/\+?55?\s?\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}\b/g, 'telefone oculto');
}

function safeStringify(obj, maxLen = 2000) {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (typeof s !== 'string') return '';
    return s.length > maxLen ? `${s.slice(0, maxLen)}\n...` : s;
  } catch {
    return '';
  }
}

export function useSupportTimelinePresentation({ safeGetBodyText, phoneMaskingEnabled = false }) {
  const maskText = useCallback((t) => (phoneMaskingEnabled ? redactSensitiveText(t) : t), [phoneMaskingEnabled]);
  const getDeliveryStatusBadge = useCallback((deliveryStatusRaw) => {
    const s = deliveryStatusRaw ? String(deliveryStatusRaw).toLowerCase() : '';
    if (!s) return null;
    if (s === 'pending') return { text: '...', title: 'Pendente', color: '#6b7280' };
    if (s === 'sent') return { text: '✓', title: 'Enviado', color: '#6b7280' };
    if (s === 'delivered') return { text: '✓✓', title: 'Entregue', color: '#6b7280' };
    if (s === 'read') return { text: '✓✓', title: 'Lido', color: '#2563eb' };
    if (s === 'failed') return { text: '!', title: 'Falhou', color: '#b91c1c' };
    return { text: s, title: s, color: '#6b7280' };
  }, []);

  const renderTimelineMessageContent = useCallback((msg) => {
    if (!msg || msg.source !== 'channel' || !msg.channel) {
      return <>{maskText(msg?.text)}</>;
    }

    const cm = msg.channel;
    const type = String(cm?.type || '').toLowerCase();
    const body = cm?.body || {};
    const text = maskText(safeGetBodyText(body));

    const commonMeta = (() => {
      if (Array.isArray(body.attachments) && body.attachments[0]?.payload?.url) {
        return { url: String(body.attachments[0].payload.url) };
      }
      if (typeof body.url === 'string') return { url: body.url };
      return {};
    })();

    if (type === 'text') return <>{text}</>;

    if (type === 'interactive') {
      const interactive = body.interactive || body.raw?.interactive || {};
      const buttonTitle = interactive?.button_reply?.title || null;
      const listTitle = interactive?.list_reply?.title || null;
      const chosen = buttonTitle || listTitle;

      return (
        <div>
          <div className="font-semibold text-[13px] mb-1">Interativo</div>
          {chosen ? <div style={{ marginBottom: '6px' }}>Resposta: <strong>{String(chosen)}</strong></div> : null}
          <details style={{ marginTop: '6px' }}>
            <summary style={{ cursor: 'pointer', color: '#555' }}>Ver payload</summary>
            <pre style={{ marginTop: '8px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
              {safeStringify(interactive || body, 3000) || '[sem payload]'}
            </pre>
          </details>
        </div>
      );
    }

    if (type === 'image' || type === 'document' || type === 'audio' || type === 'voice' || type === 'video') {
      const labels = {
        image: 'Imagem',
        document: 'Documento',
        audio: 'Audio',
        voice: 'Audio',
        video: 'Video',
      };
      const url = commonMeta.url || body?.[type]?.link || null;
      return (
        <div>
          <div className="font-semibold text-[13px] mb-1">{labels[type] || 'Midia'}</div>
          {text ? <div style={{ marginBottom: '6px' }}>{text}</div> : null}
          {url ? <a href={url} target="_blank" rel="noreferrer">Abrir midia</a> : <div style={{ fontSize: '12px', color: '#666' }}>Midia sem URL publica</div>}
        </div>
      );
    }

    return (
      <div>
        <div style={{ marginBottom: '6px' }}>{maskText(msg.text)}</div>
        <details>
          <summary style={{ cursor: 'pointer', color: '#555' }}>Ver payload</summary>
          <pre style={{ marginTop: '8px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
            {safeStringify(body, 3000) || '[sem payload]'}
          </pre>
        </details>
      </div>
    );
  }, [safeGetBodyText, maskText]);

  return {
    getDeliveryStatusBadge,
    renderTimelineMessageContent,
  };
}
