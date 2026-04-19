'use strict';

const { resolveStorefrontToken, enforceStorefrontRateLimit } = require('./publicMarketingHelpers');

async function handlePublicMarketingRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    checkRateLimit,
    setCorsHeaders,
  } = deps;

  if (method === 'GET' && pathname === '/mkt/track.js') {
    try {
      const tokenInfo = await resolveStorefrontToken(req, res, sendJson);
      if (!tokenInfo) return true;
      const { token, resolved } = tokenInfo;
      const allowed = await enforceStorefrontRateLimit(resolved, res, sendJson, checkRateLimit);
      if (!allowed) return true;

      const js = `
(function(){
  var endpoint = "/mkt/e?token=${String(token).replace(/"/g, '\\"')}";
  function collectAttribution(){
    try {
      var params = new URLSearchParams(location.search || "");
      var keys = ["utm_source","utm_campaign","utm_medium","utm_content","utm_term","gclid","gbraid","wbraid"];
      var out = {};
      keys.forEach(function(key){
        var value = params.get(key);
        if (value) out[key] = value;
      });
      out.pageUrl = location.href;
      if (document.referrer) out.referrer = document.referrer;
      return out;
    } catch(e) {
      return {};
    }
  }
  function send(evt){
    try{
      evt = evt || {};
      evt.ts = evt.ts || Date.now();
      evt.attribution = Object.assign({}, collectAttribution(), evt.attribution || {});
      if (evt.props && typeof evt.props === "object") {
        evt.props = Object.assign({}, collectAttribution(), evt.props || {});
      }
      var payload = JSON.stringify(evt);
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], {type: "application/json"});
        navigator.sendBeacon(endpoint, blob);
        return;
      }
      fetch(endpoint, {method:"POST", headers:{"Content-Type":"application/json"}, body: payload, keepalive:true}).catch(function(){});
    }catch(e){}
  }
  send({ type: "pageview", url: location.href, referrer: document.referrer || null, title: document.title || null });
  window.mktIdentify = function(data){ send(Object.assign({ type: "identify" }, data || {})); };
  window.mktEvent = function(name, props){ send({ type: "event", name: String(name||""), props: props||{} }); };
})();`;

      setCorsHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(js);
    } catch (err) {
      logger.error('[Marketing] Erro em GET /mkt/track.js', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao gerar tracker' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/mkt/e') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const tokenInfo = await resolveStorefrontToken(req, res, sendJson);
      if (!tokenInfo) return true;
      const { resolved } = tokenInfo;
      const allowed = await enforceStorefrontRateLimit(resolved, res, sendJson, checkRateLimit);
      if (!allowed) return true;

      const body = await parseJsonBody(req);
      const evtType = body && body.type ? String(body.type).trim().toLowerCase() : 'event';
      const tenantId = resolved.tenantId;
      const externalId = body && (body.externalId || body.external_id) ? String(body.externalId || body.external_id).trim() : null;
      const email = body && body.email ? String(body.email).trim() : null;
      const phone = body && body.phone ? String(body.phone).trim() : null;
      const name = body && body.name ? String(body.name).trim() : null;
      const leadAttributes = {
        ...(body && body.props && typeof body.props === 'object' ? body.props : {}),
        ...(body && body.attribution && typeof body.attribution === 'object' ? { attribution: body.attribution } : {}),
        ...(body && body.url ? { url: body.url } : {}),
        ...(body && body.referrer ? { referrer: body.referrer } : {}),
        ...(body && body.title ? { title: body.title } : {}),
      };
      const marketing = require('../../services/marketing/marketingService');
      const leadRes = (email || phone || externalId)
        ? await marketing.upsertLead({ tenantId, email, phone, externalId, name, attributesPatch: leadAttributes })
        : null;
      const lead = leadRes && leadRes.ok ? leadRes.lead : null;

      const mapped =
        evtType === 'pageview' ? 'MarketingPageView'
          : evtType === 'identify' ? 'MarketingIdentify'
            : evtType === 'form_submit' ? 'MarketingFormSubmitted'
              : 'MarketingCustomEvent';

      await marketing.recordMarketingEvent({
        tenantId,
        eventType: mapped,
        correlationId: body && body.idempotencyKey ? String(body.idempotencyKey) : null,
        lead,
        payload: {
          ...(body && typeof body === 'object' ? body : {}),
          publicTokenId: resolved.tokenId,
        },
      });
      if (lead && lead.id) {
        await marketing.applyScoring({ tenantId, leadId: lead.id, eventType: mapped, payload: body || {} }).catch(() => null);
      }

      sendJson(res, 200, { ok: true });
    } catch (err) {
      logger.error('[Marketing] Erro em POST /mkt/e', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao registrar evento' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/mkt/l/')) {
    try {
      const code = decodeURIComponent(pathname.slice('/mkt/l/'.length)).trim();
      if (!code) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const service = require('../../services/marketing/marketingLinkService');
      const link = await service.getLinkByCode(code);
      if (!link || link.status !== 'active') {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const trackedUrl = service.buildTrackedUrl(link, urlObj.searchParams.toString());
      await service.recordClick({
        link,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        referrer: req.headers.referer || req.headers.referrer || null,
      }).catch(() => {});
      res.writeHead(302, { Location: trackedUrl });
      res.end();
    } catch (err) {
      logger.error('[Marketing] Erro em GET /mkt/l/:code', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao redirecionar' });
    }
    return true;
  }

  if ((method === 'GET' || method === 'POST') && pathname === '/mkt/click') {
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const code = urlObj.searchParams.get('code');
      if (!code) {
        sendJson(res, 400, { error: 'bad_request', message: 'code é obrigatório' });
        return true;
      }
      const service = require('../../services/marketing/marketingLinkService');
      const link = await service.getLinkByCode(code);
      if (!link || link.status !== 'active') {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      await service.recordClick({
        link,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        referrer: req.headers.referer || req.headers.referrer || null,
      }).catch(() => {});
      res.writeHead(204);
      res.end();
    } catch (err) {
      logger.error('[Marketing] Erro em /mkt/click', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao registrar click' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/lp/')) {
    try {
      const slug = decodeURIComponent(pathname.slice('/lp/'.length)).trim();
      const tokenInfo = await resolveStorefrontToken(req, res, sendJson);
      if (!tokenInfo) return true;
      const { token, resolved } = tokenInfo;
      const marketing = require('../../services/marketing/marketingService');
      const form = await marketing.getFormBySlug({ tenantId: resolved.tenantId, slug });
      if (!form || form.status !== 'active') {
        sendJson(res, 404, { error: 'not_found', message: 'Landing page não encontrada' });
        return true;
      }

      const fields = Array.isArray(form.fields) ? form.fields : (Array.isArray(form.fields?.items) ? form.fields.items : []);
      const fieldsHtml = fields.map((field) => {
        const name = String(field.name || '').trim();
        if (!name) return '';
        const label = String(field.label || name);
        const type = String(field.type || 'text');
        const required = field.required === true ? 'required' : '';
        return `<label style="display:block;margin:8px 0 4px;">${label}</label><input ${required} style="width:100%;padding:10px" name="${name}" type="${type}"/>`;
      }).join('\n');

      const html = form.landing_html && String(form.landing_html).trim()
        ? String(form.landing_html)
        : `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${String(form.name || 'Form')}</title></head>
<body style="font-family:system-ui,Arial;margin:24px;max-width:720px">
  <h1>${String(form.name || '')}</h1>
  <form id="mktForm">
    ${fieldsHtml || '<label>Email</label><input name="email" type="email" required style="width:100%;padding:10px"/>'}
    <div style="margin-top:12px"><button type="submit" style="padding:10px 14px">Enviar</button></div>
  </form>
  <div id="mktMsg" style="margin-top:12px"></div>
  <script src="/mkt/track.js?token=${encodeURIComponent(String(token))}"></script>
  <script>
    (function(){
      function collectAttribution(){
        try {
          var params = new URLSearchParams(location.search || "");
          var keys = ["utm_source","utm_campaign","utm_medium","utm_content","utm_term","gclid","gbraid","wbraid"];
          var out = {};
          keys.forEach(function(key){
            var value = params.get(key);
            if (value) out[key] = value;
          });
          out.landingUrl = location.href;
          if (document.referrer) out.referrer = document.referrer;
          return out;
        } catch (e) {
          return {};
        }
      }
      var form = document.getElementById("mktForm");
      var msg = document.getElementById("mktMsg");
      form.addEventListener("submit", function(e){
        e.preventDefault();
        var data = {};
        new FormData(form).forEach(function(v,k){ data[k]=v; });
        var tracking = collectAttribution();
        Object.keys(tracking).forEach(function(key){
          if (!data[key]) data[key] = tracking[key];
        });
        data.__tracking = tracking;
        fetch("/lp/${encodeURIComponent(slug)}/submit?token=${encodeURIComponent(String(token))}", {
          method:"POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ data: data, submissionId: "sub-"+Date.now()+"-"+Math.random().toString(36).slice(2,9) })
        }).then(function(r){ return r.json(); }).then(function(out){
          if(out && out.ok){ msg.textContent = "Enviado! Obrigado."; if(window.mktEvent) window.mktEvent("form_submitted",{slug:"${encodeURIComponent(slug)}"}); }
          else { msg.textContent = (out && out.message) ? out.message : "Falha ao enviar"; }
        }).catch(function(){ msg.textContent = "Falha ao enviar"; });
      });
    })();
  </script>
</body></html>`;

      setCorsHeaders(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (err) {
      logger.error('[Marketing] Erro em GET /lp/:slug', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao carregar landing page' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/lp/') && pathname.endsWith('/submit')) {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const slug = decodeURIComponent(pathname.slice('/lp/'.length).replace(/\/submit$/, '')).trim();
      const tokenInfo = await resolveStorefrontToken(req, res, sendJson);
      if (!tokenInfo) return true;
      const { resolved } = tokenInfo;
      const allowed = await enforceStorefrontRateLimit(resolved, res, sendJson, checkRateLimit);
      if (!allowed) return true;

      const body = await parseJsonBody(req);
      const marketing = require('../../services/marketing/marketingService');
      const out = await marketing.submitForm({
        tenantId: resolved.tenantId,
        slug,
        submissionId: body && body.submissionId ? String(body.submissionId).trim() : null,
        data: body && body.data ? body.data : {},
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
      });
      if (!out.ok) {
        const map = { form_not_found: 'Form não encontrado', slug_required: 'Slug inválido' };
        sendJson(res, 400, { ok: false, error: out.error, message: map[out.error] || 'Falha ao enviar' });
        return true;
      }
      sendJson(res, 200, { ok: true, leadId: out.lead?.id || null, submissionId: out.submission?.id || null });
    } catch (err) {
      logger.error('[Marketing] Erro em POST /lp/:slug/submit', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao enviar formulário' });
    }
    return true;
  }

  return false;
}

module.exports = { handlePublicMarketingRoutes };
