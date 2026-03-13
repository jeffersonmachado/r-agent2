async function handlePublicSystemRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    config,
    checkRateLimit,
    setCorsHeaders,
    requireAuth,
  } = deps;

  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return true;
  }

  if (method === 'GET' && pathname === '/health/live') {
    const uptimeSec = Math.floor(process.uptime());
    sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSec,
    });
    return true;
  }

  if (method === 'GET' && pathname === '/health/db') {
    try {
      const dbHealth = require('../db/health');
      const connectionCheck = await dbHealth.checkDbConnection();
      const dbInfo = dbHealth.getDbInfo();
      const migrationStatus = await dbHealth.getMigrationStatusSafe();
      const syncStatus = dbHealth.getSyncStatus();
      const environment = dbHealth.getEnvironment();

      if (!connectionCheck.ok) {
        sendJson(res, 503, {
          status: 'fail',
          environment,
          latencyMs: connectionCheck.latencyMs,
          db: dbInfo,
          migrations: {
            applied: migrationStatus.appliedCount,
            pending: migrationStatus.pendingCount,
            pendingNames: migrationStatus.pendingNames,
          },
          sync: syncStatus,
          errorMessage: connectionCheck.errorMessage,
          timestamp: new Date().toISOString(),
        });
        return true;
      }

      sendJson(res, 200, {
        status: 'ok',
        environment,
        latencyMs: connectionCheck.latencyMs,
        db: dbInfo,
        migrations: {
          applied: migrationStatus.appliedCount,
          pending: migrationStatus.pendingCount,
          pendingNames: migrationStatus.pendingNames,
        },
        sync: syncStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Health DB] Erro ao verificar banco de dados:', err);
      const dbHealth = require('../db/health');
      const dbInfo = dbHealth.getDbInfo();
      const environment = dbHealth.getEnvironment();

      sendJson(res, 503, {
        status: 'fail',
        environment,
        latencyMs: 0,
        db: dbInfo,
        migrations: {
          applied: 0,
          pending: 0,
          pendingNames: [],
        },
        errorMessage: err.message || 'Erro ao verificar banco de dados',
        timestamp: new Date().toISOString(),
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/health/ready') {
    try {
      const dbHealth = require('../db/health');
      const connectionCheck = await dbHealth.checkDbConnection();

      if (!connectionCheck.ok) {
        sendJson(res, 503, {
          status: 'not_ready',
          reason: 'db_connection_failed',
          timestamp: new Date().toISOString(),
        });
        return true;
      }

      const migrationStatus = await dbHealth.getMigrationStatusSafe();
      if (migrationStatus.pendingCount > 0) {
        sendJson(res, 503, {
          status: 'not_ready',
          reason: 'migrations_pending',
          pending: migrationStatus.pendingCount,
          pendingNames: migrationStatus.pendingNames,
          timestamp: new Date().toISOString(),
        });
        return true;
      }

      sendJson(res, 200, {
        status: 'ready',
        db: 'ok',
        migrationsPending: 0,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Health Ready] Erro ao verificar readiness:', err);
      sendJson(res, 503, {
        status: 'not_ready',
        reason: 'check_failed',
        error: err.message || 'Erro ao verificar readiness',
        timestamp: new Date().toISOString(),
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/ready') {
    req.url = '/health/ready';
    return handlePublicSystemRoutes({ req, res, method, pathname: '/health/ready', deps });
  }

  if (method === 'GET' && (pathname === '/health/selftest' || pathname === '/selftest')) {
    try {
      const { runSelftest } = require('../services/selftestService');
      const result = await runSelftest();
      const httpStatus = result.status === 'FAIL' ? 503 : 200;
      sendJson(res, httpStatus, result);
    } catch (err) {
      logger.error('[Selftest] Erro ao executar selftest:', err);
      sendJson(res, 503, {
        status: 'FAIL',
        error: err.message || 'selftest_failed',
        meta: { timestamp: new Date().toISOString() },
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/version') {
    sendJson(res, 200, {
      name: 'chatbot-engine-api',
      env: config.get('nodeEnv', 'development'),
    });
    return true;
  }

  if (method === 'GET' && pathname === '/mkt/track.js') {
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const token = urlObj.searchParams.get('token');
      if (!token) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
        return true;
      }
      const { resolvePublicToken } = require('../services/publicAccessTokenService');
      const resolved = await resolvePublicToken({ token, allowedKinds: ['storefront'] });
      if (!resolved.ok) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
        return true;
      }

      const rl = await checkRateLimit({
        userId: `publicToken:${resolved.tokenId}`,
        operationType: 'PUBLIC_TOKEN_STOREFRONT',
      });
      if (!rl.allowed) {
        res.setHeader('Retry-After', rl.retryAfter || 60);
        sendJson(res, 429, { error: 'rate_limit_exceeded', retryAfter: rl.retryAfter || 60 });
        return true;
      }

      const js = `
(function(){
  var endpoint = "/mkt/e?token=${String(token).replace(/"/g, '\\"')}";
  function send(evt){
    try{
      evt = evt || {};
      evt.ts = evt.ts || Date.now();
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
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const token = urlObj.searchParams.get('token');
      if (!token) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
        return true;
      }
      const { resolvePublicToken } = require('../services/publicAccessTokenService');
      const resolved = await resolvePublicToken({ token, allowedKinds: ['storefront'] });
      if (!resolved.ok) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
        return true;
      }

      const rl = await checkRateLimit({
        userId: `publicToken:${resolved.tokenId}`,
        operationType: 'PUBLIC_TOKEN_STOREFRONT',
      });
      if (!rl.allowed) {
        res.setHeader('Retry-After', rl.retryAfter || 60);
        sendJson(res, 429, { error: 'rate_limit_exceeded', retryAfter: rl.retryAfter || 60 });
        return true;
      }

      const body = await parseJsonBody(req);
      const evtType = body && body.type ? String(body.type).trim().toLowerCase() : 'event';
      const tenantId = resolved.tenantId;
      const externalId = body && (body.externalId || body.external_id) ? String(body.externalId || body.external_id).trim() : null;
      const email = body && body.email ? String(body.email).trim() : null;
      const phone = body && body.phone ? String(body.phone).trim() : null;
      const name = body && body.name ? String(body.name).trim() : null;

      const marketing = require('../services/marketing/marketingService');
      const leadRes = (email || phone || externalId)
        ? await marketing.upsertLead({ tenantId, email, phone, externalId, name, attributesPatch: body && body.props ? body.props : null })
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
      const service = require('../services/marketing/marketingLinkService');
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
      const service = require('../services/marketing/marketingLinkService');
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
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const token = urlObj.searchParams.get('token');
      if (!token) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
        return true;
      }
      const { resolvePublicToken } = require('../services/publicAccessTokenService');
      const resolved = await resolvePublicToken({ token, allowedKinds: ['storefront'] });
      if (!resolved.ok) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
        return true;
      }

      const marketing = require('../services/marketing/marketingService');
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
      var form = document.getElementById("mktForm");
      var msg = document.getElementById("mktMsg");
      form.addEventListener("submit", function(e){
        e.preventDefault();
        var data = {};
        new FormData(form).forEach(function(v,k){ data[k]=v; });
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
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const token = urlObj.searchParams.get('token');
      if (!token) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
        return true;
      }
      const { resolvePublicToken } = require('../services/publicAccessTokenService');
      const resolved = await resolvePublicToken({ token, allowedKinds: ['storefront'] });
      if (!resolved.ok) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
        return true;
      }
      const rl = await checkRateLimit({
        userId: `publicToken:${resolved.tokenId}`,
        operationType: 'PUBLIC_TOKEN_STOREFRONT',
      });
      if (!rl.allowed) {
        res.setHeader('Retry-After', rl.retryAfter || 60);
        sendJson(res, 429, { error: 'rate_limit_exceeded', retryAfter: rl.retryAfter || 60 });
        return true;
      }

      const body = await parseJsonBody(req);
      const submissionId = body && body.submissionId ? String(body.submissionId).trim() : null;
      const data = body && body.data ? body.data : {};
      const marketing = require('../services/marketing/marketingService');
      const out = await marketing.submitForm({
        tenantId: resolved.tenantId,
        slug,
        submissionId,
        data,
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

  if (method === 'GET' && pathname.startsWith('/provision/')) {
    try {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length !== 4 && parts.length !== 5) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }

      const provisioningToken = (process.env.PROVISIONING_PUBLIC_TOKEN || '').trim();
      const tenantKey = String(parts[1] || '').trim();

      let token = null;
      let vendor = null;
      let mac = null;
      if (parts.length === 4) {
        [vendor, mac] = [parts[2], parts[3]];
      } else {
        [token, vendor, mac] = [parts[2], parts[3], parts[4]];
      }

      if (!tenantKey) {
        sendJson(res, 400, { error: 'bad_request', code: 'tenant_required', message: 'tenantKey é obrigatório' });
        return true;
      }

      let tenantProvisioningToken = null;
      try {
        const { getProvisioningToken } = require('../services/pbx/pbxProvisioningTokenService');
        const tokenResult = await getProvisioningToken({ tenantKey, includeToken: true });
        if (tokenResult && tokenResult.ok && tokenResult.token) {
          tenantProvisioningToken = String(tokenResult.token);
        }
      } catch (_) {}

      const tokenRequired = !!provisioningToken || !!tenantProvisioningToken;
      if (tokenRequired) {
        if (!token) {
          sendJson(res, 403, { error: 'forbidden', code: 'provisioning_token_required' });
          return true;
        }
        const ok = (provisioningToken && token === provisioningToken) || (tenantProvisioningToken && token === tenantProvisioningToken);
        if (!ok) {
          sendJson(res, 403, { error: 'forbidden', code: 'invalid_provisioning_token' });
          return true;
        }
      }

      const hostHeader = String(req.headers?.host || '').trim();
      const hostNoPort = hostHeader.includes(':') ? hostHeader.split(':')[0] : hostHeader;
      const serverHost = (process.env.PROVISIONING_SIP_HOST || '').trim() || hostNoPort || 'localhost';

      const { generateProvisioning } = require('../services/pbx/pbxProvisioningService');
      const out = await generateProvisioning({ tenantKey, vendor, mac, serverHost });

      setCorsHeaders(res);
      res.writeHead(200, {
        'Content-Type': out.contentType || 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(out.body || '');
    } catch (err) {
      const code = err.code || 'provisioning_error';
      const httpStatus = ['invalid_mac', 'invalid_provisioning_vendor', 'invalid_provisioning_template'].includes(code)
        ? 400
        : code === 'extension_not_found_for_mac'
          ? 404
          : 500;
      logger.error('[Provisioning] Erro em GET /provision', err);
      sendJson(res, httpStatus, { error: 'provisioning_error', code, message: err.message || 'Erro ao gerar provisionamento' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/system/status') {
    try {
      const { checkServicesStatus } = require('../services/systemStatusService');
      const status = await checkServicesStatus();

      try {
        const executionIdHeader = (req.headers && (req.headers['x-execution-id'] || req.headers['x-pipeline-execution-id'])) || null;
        const executionId = (typeof executionIdHeader === 'string' && executionIdHeader.trim()) ? executionIdHeader.trim() : null;
        const isValidExecutionId = !!(executionId && executionId.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(executionId));
        if (isValidExecutionId) {
          const authResult = requireAuth(req);
          if (authResult.valid && authResult.agent?.tenantId) {
            const tenantId = String(authResult.agent.tenantId);
            const ragService = status?.services?.ragService || null;
            if (ragService && ragService.status === 'healthy') {
              const { emitEvent } = require('../services/websocketService');
              emitEvent('pipeline.status', {
                executionId,
                status: 'running',
                stages: { ragValidated: true },
                metadata: { message: 'Serviço RAG validado', source: '/system/status' },
              }, { tenantId });
            }
          }
        }
      } catch (_) {}

      sendJson(res, 200, status);
    } catch (err) {
      logger.error('Erro ao verificar status dos serviços:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao verificar status dos serviços',
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/system/websocket') {
    try {
      const { getConnectionsInfo } = require('../services/websocketService');
      const info = getConnectionsInfo();
      sendJson(res, 200, info);
    } catch (err) {
      logger.error('Erro ao obter informações de WebSocket:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao obter informações de WebSocket',
      });
    }
    return true;
  }

  return false;
}

module.exports = { handlePublicSystemRoutes };