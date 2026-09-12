'use strict';

/**
 * MCP Endpoint Policy — fronteira de rede do MCP Client.
 *
 * Um MCP server externo é um BOUNDARY de rede controlado por terceiros. Sem
 * política explícita, um endpoint configurado (ou redirecionado) pode levar o
 * RAP a falar com o próprio runtime (localhost), com serviços de metadata de
 * cloud (169.254.169.254) ou com a rede interna do tenant — o padrão clássico
 * de SSRF.
 *
 * Este módulo é PURO (zero I/O): recebe endpoint, classificação e endereços já
 * resolvidos e devolve decisão auditável. A resolução DNS real acontece em
 * `resolveAndValidateEndpoint` (client-hub), que revalida ANTES de conectar
 * (DNS rebinding: hostname público que resolve para IP privado proibido).
 *
 * Regras:
 *  - https é obrigatório por padrão; http só com exceção EXPLÍCITA e apenas em
 *    classificação SUPPORT/DEVELOPMENT (nunca PRODUCTION).
 *  - `rejectUnauthorized: false` nunca é aceito silenciosamente: exige
 *    `allowInsecureTls: true` E classificação não-PRODUCTION E justificativa.
 *  - Endereço loopback/link-local/metadata/privado é bloqueado por padrão.
 *    Exceções são POR CONEXÃO (`allowPrivateNetwork: true`) e nunca para
 *    metadata de cloud.
 *  - Redirect de um host público para host proibido é bloqueado: a decisão é
 *    sempre reavaliada no destino final, não apenas no endpoint declarado.
 */

const ALLOWED_PROTOCOLS = Object.freeze(['https:']);
const DEV_ALLOWED_PROTOCOLS = Object.freeze(['https:', 'http:']);

const CLASSIFICATION_RANK = Object.freeze({ PRODUCTION: 0, SUPPORT: 1, DEVELOPMENT: 2 });

/** Hostnames que nunca são destino válido de um MCP externo. */
const BLOCKED_HOSTNAMES = Object.freeze([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'metadata.azure.internal',
]);

const BLOCKED_HOSTNAME_SUFFIXES = Object.freeze([
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
]);

/** Códigos de bloqueio estáveis (auditáveis; nunca texto livre). */
const ENDPOINT_DENIAL_CODES = Object.freeze({
  INVALID_ENDPOINT: 'mcp_endpoint_invalid',
  UNSUPPORTED_PROTOCOL: 'mcp_endpoint_protocol_not_allowed',
  PLAINTEXT_HTTP_PRODUCTION: 'mcp_endpoint_plaintext_http_forbidden_in_production',
  BLOCKED_HOSTNAME: 'mcp_endpoint_hostname_blocked',
  CREDENTIALS_IN_URL: 'mcp_endpoint_credentials_in_url_forbidden',
  LOOPBACK: 'mcp_endpoint_loopback_forbidden',
  LINK_LOCAL: 'mcp_endpoint_link_local_forbidden',
  CLOUD_METADATA: 'mcp_endpoint_cloud_metadata_forbidden',
  PRIVATE_NETWORK: 'mcp_endpoint_private_network_forbidden',
  RESERVED_RANGE: 'mcp_endpoint_reserved_range_forbidden',
  UNPARSEABLE_IP: 'mcp_endpoint_ip_unparseable',
  DNS_REBINDING: 'mcp_endpoint_dns_rebinding_detected',
  INSECURE_TLS: 'mcp_endpoint_insecure_tls_forbidden',
  REDIRECT_BLOCKED: 'mcp_endpoint_redirect_blocked',
});

function classificationRank(classification) {
  const rank = CLASSIFICATION_RANK[String(classification || '').toUpperCase()];
  return rank === undefined ? 0 : rank;
}

function isProduction(classification) {
  return classificationRank(classification) === 0;
}

/**
 * Parse de IPv4 literal para octetos. Retorna null quando não é IPv4.
 */
function parseIpv4(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * Classifica um IPv4 literal em faixas sensíveis.
 * @returns {{category: string|null, code: string|null}}
 */
function classifyIpv4(value) {
  const octets = parseIpv4(value);
  if (!octets) return { category: null, code: ENDPOINT_DENIAL_CODES.UNPARSEABLE_IP };
  const [a, b] = octets;

  // Cloud metadata (AWS/GCP/Azure/OpenStack) — nunca permitido, sem exceção.
  if (a === 169 && b === 254) {
    return { category: 'cloud_metadata', code: ENDPOINT_DENIAL_CODES.CLOUD_METADATA };
  }
  if (a === 127) return { category: 'loopback', code: ENDPOINT_DENIAL_CODES.LOOPBACK };
  if (a === 0) return { category: 'reserved', code: ENDPOINT_DENIAL_CODES.RESERVED_RANGE };
  if (a === 100 && b >= 64 && b <= 127) {
    return { category: 'private', code: ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK };
  }
  if (a === 10) return { category: 'private', code: ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK };
  if (a === 172 && b >= 16 && b <= 31) {
    return { category: 'private', code: ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK };
  }
  if (a === 192 && b === 168) {
    return { category: 'private', code: ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK };
  }
  if (a === 192 && b === 0) return { category: 'reserved', code: ENDPOINT_DENIAL_CODES.RESERVED_RANGE };
  if (a === 198 && (b === 18 || b === 19)) {
    return { category: 'reserved', code: ENDPOINT_DENIAL_CODES.RESERVED_RANGE };
  }
  if (a >= 224) return { category: 'reserved', code: ENDPOINT_DENIAL_CODES.RESERVED_RANGE };
  return { category: null, code: null };
}

/**
 * Classifica um IPv6 literal em faixas sensíveis.
 * Suporta forma comprimida e IPv4-mapped (`::ffff:127.0.0.1`).
 */
function classifyIpv6(value) {
  const raw = String(value).trim().replace(/^\[|\]$/g, '').toLowerCase();
  const zoneIndex = raw.indexOf('%');
  const address = zoneIndex === -1 ? raw : raw.slice(0, zoneIndex);

  // IPv4-mapped / IPv4-compatible: extrai e delega.
  const mappedMatch = address.match(/(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedMatch) return classifyIpv4(mappedMatch[1]);

  if (address === '::1' || address === '0:0:0:0:0:0:0:1') {
    return { category: 'loopback', code: ENDPOINT_DENIAL_CODES.LOOPBACK };
  }
  if (address === '::' || address === '0:0:0:0:0:0:0:0') {
    return { category: 'reserved', code: ENDPOINT_DENIAL_CODES.RESERVED_RANGE };
  }
  if (address.startsWith('fe80:')) {
    return { category: 'link_local', code: ENDPOINT_DENIAL_CODES.LINK_LOCAL };
  }
  if (address.startsWith('fec0:')) {
    return { category: 'private', code: ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK };
  }
  // ULA fc00::/7
  if (address.startsWith('fc') || address.startsWith('fd')) {
    return { category: 'private', code: ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK };
  }
  // 6to4 (2002::/16) e Teredo (2001:0000::/32) podem encapsular IPv4 privado:
  // tratados como reservado — não é destino legítimo de MCP externo.
  if (address.startsWith('2002:') || address.startsWith('2001:0:')) {
    return { category: 'reserved', code: ENDPOINT_DENIAL_CODES.RESERVED_RANGE };
  }
  if (address.startsWith('ff')) {
    return { category: 'reserved', code: ENDPOINT_DENIAL_CODES.RESERVED_RANGE };
  }
  return { category: null, code: null };
}

function isIpLiteral(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, '');
  if (parseIpv4(host)) return true;
  return host.includes(':');
}

/**
 * Classifica um endereço IP resolvido (v4 ou v6).
 * @returns {{category: string|null, code: string|null}}
 */
function classifyAddress(address) {
  const host = String(address).trim().replace(/^\[|\]$/g, '');
  if (!host) return { category: null, code: null };
  if (parseIpv4(host)) return classifyIpv4(host);
  if (host.includes(':')) return classifyIpv6(host);
  return { category: null, code: ENDPOINT_DENIAL_CODES.UNPARSEABLE_IP };
}

/**
 * Normaliza opções de política por conexão.
 * `allowPrivateNetwork` não habilita metadata de cloud — nunca.
 */
function normalizeEndpointPolicy(policy = {}) {
  return Object.freeze({
    allowPrivateNetwork: policy.allowPrivateNetwork === true,
    allowInsecureTls: policy.allowInsecureTls === true,
    allowPlaintextHttp: policy.allowPlaintextHttp === true,
    insecureTlsJustification: typeof policy.insecureTlsJustification === 'string'
      ? policy.insecureTlsJustification.trim()
      : '',
    maxRedirects: Number.isFinite(Number(policy.maxRedirects)) ? Number(policy.maxRedirects) : 3,
  });
}

/**
 * Avalia o endpoint DECLARADO da conexão (antes de resolver DNS).
 *
 * @param {object} args
 * @param {string} args.endpoint             URL declarada na conexão
 * @param {string} [args.classification]     PRODUCTION | SUPPORT | DEVELOPMENT
 * @param {object} [args.policy]             normalizeEndpointPolicy input
 * @returns {{allowed: boolean, code: string|null, detail: object}}
 */
function evaluateEndpoint({ endpoint, classification = 'PRODUCTION', policy } = {}) {
  const effectivePolicy = normalizeEndpointPolicy(policy);
  const denial = (code, detail = {}) => ({ allowed: false, code, detail: { ...detail, effectivePolicy } });

  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    return denial(ENDPOINT_DENIAL_CODES.INVALID_ENDPOINT, { reason: 'endpoint_required' });
  }

  let url;
  try {
    url = new URL(endpoint);
  } catch (_) {
    return denial(ENDPOINT_DENIAL_CODES.INVALID_ENDPOINT, { reason: 'unparseable_url' });
  }

  const isProd = isProduction(classification);
  const allowedProtocols = isProd ? ALLOWED_PROTOCOLS : (effectivePolicy.allowPlaintextHttp ? DEV_ALLOWED_PROTOCOLS : ALLOWED_PROTOCOLS);

  // http em PRODUCTION tem código próprio (diagnóstico mais preciso do que
  // "protocolo não suportado"): é negado mesmo com allowPlaintextHttp.
  if (isProd && url.protocol === 'http:') {
    return denial(ENDPOINT_DENIAL_CODES.PLAINTEXT_HTTP_PRODUCTION, { protocol: url.protocol });
  }

  if (!allowedProtocols.includes(url.protocol)) {
    if (!isProd && url.protocol === 'http:') {
      return denial(ENDPOINT_DENIAL_CODES.UNSUPPORTED_PROTOCOL, { protocol: url.protocol, reason: 'plaintext_http_not_enabled' });
    }
    return denial(ENDPOINT_DENIAL_CODES.UNSUPPORTED_PROTOCOL, { protocol: url.protocol });
  }

  if (url.username || url.password) {
    return denial(ENDPOINT_DENIAL_CODES.CREDENTIALS_IN_URL, { reason: 'use_authRef_instead' });
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return denial(ENDPOINT_DENIAL_CODES.BLOCKED_HOSTNAME, { hostname });
  }

  if (isIpLiteral(hostname)) {
    const { category, code } = classifyAddress(hostname);
    if (code) {
      const exempt = category === 'private' && effectivePolicy.allowPrivateNetwork && !isProd;
      if (!exempt) return denial(code, { hostname, category });
      return { allowed: true, code: null, detail: { hostname, category, privateNetworkExempt: true, effectivePolicy } };
    }
  }

  if (effectivePolicy.allowInsecureTls) {
    if (isProd) return denial(ENDPOINT_DENIAL_CODES.INSECURE_TLS, { reason: 'production_cannot_disable_tls_verification' });
    if (!effectivePolicy.insecureTlsJustification) {
      return denial(ENDPOINT_DENIAL_CODES.INSECURE_TLS, { reason: 'justification_required' });
    }
  }

  return { allowed: true, code: null, detail: { hostname, protocol: url.protocol, effectivePolicy } };
}

/**
 * Avalia os endereços RESOLVIDOS de um hostname já aprovado.
 *
 * DNS rebinding: o endpoint declarado pode ser público no momento da
 * configuração e resolver para 127.0.0.1/169.254.169.254 no momento da
 * conexão. Por isso a checagem por IP é feita a cada conexão, sobre TODOS os
 * endereços retornados (um único endereço proibido bloqueia a conexão).
 *
 * @param {object} args
 * @param {string} args.hostname
 * @param {string[]} args.addresses
 * @param {string} [args.classification]
 * @param {object} [args.policy]
 */
function evaluateResolvedAddresses({ hostname, addresses = [], classification = 'PRODUCTION', policy } = {}) {
  const effectivePolicy = normalizeEndpointPolicy(policy);
  const isProd = isProduction(classification);
  const denial = (code, detail = {}) => ({ allowed: false, code, detail: { ...detail, hostname, effectivePolicy } });

  const list = Array.isArray(addresses) ? addresses.filter(Boolean) : [];
  if (list.length === 0) {
    // Sem endereço resolvido não há decisão: fail closed.
    return denial(ENDPOINT_DENIAL_CODES.DNS_REBINDING, { reason: 'no_resolved_address' });
  }

  for (const address of list) {
    const { category, code } = classifyAddress(address);
    if (!code) continue;
    const exempt = category === 'private' && effectivePolicy.allowPrivateNetwork && !isProd;
    if (exempt) continue;
    // Bloqueio classificado como rebinding quando o hostname NÃO era um IP
    // literal — ou seja, a resolução mudou o destino para faixa proibida.
    const isName = !isIpLiteral(hostname);
    return denial(
      isName && category !== 'cloud_metadata' ? ENDPOINT_DENIAL_CODES.DNS_REBINDING : code,
      { address, category, reason: isName ? 'resolved_to_restricted_range' : 'literal_restricted_range' },
    );
  }

  return { allowed: true, code: null, detail: { hostname, addresses: list, effectivePolicy } };
}

/**
 * Aplica política a cada salto de redirect. Um redirect para host proibido é
 * bloqueado mesmo que o endpoint original seja válido.
 */
function evaluateRedirectChain(redirects = [], { classification = 'PRODUCTION', policy } = {}) {
  const effectivePolicy = normalizeEndpointPolicy(policy);
  const chain = Array.isArray(redirects) ? redirects : [];
  if (chain.length > effectivePolicy.maxRedirects) {
    return {
      allowed: false,
      code: ENDPOINT_DENIAL_CODES.REDIRECT_BLOCKED,
      detail: { reason: 'too_many_redirects', count: chain.length, max: effectivePolicy.maxRedirects },
    };
  }
  for (const hop of chain) {
    const evaluated = evaluateEndpoint({ endpoint: hop, classification, policy: effectivePolicy });
    if (!evaluated.allowed) {
      return {
        allowed: false,
        code: ENDPOINT_DENIAL_CODES.REDIRECT_BLOCKED,
        detail: { reason: 'redirect_target_rejected', target: hop, cause: evaluated.code },
      };
    }
  }
  return { allowed: true, code: null, detail: { hops: chain.length } };
}

/**
 * Decide se a verificação TLS deve ser mantida. Nunca devolve
 * `rejectUnauthorized: false` sem política explícita não-PRODUCTION.
 */
function resolveTlsOptions({ classification = 'PRODUCTION', policy } = {}) {
  const effectivePolicy = normalizeEndpointPolicy(policy);
  const isProd = isProduction(classification);
  if (effectivePolicy.allowInsecureTls && !isProd && effectivePolicy.insecureTlsJustification) {
    return {
      rejectUnauthorized: false,
      insecure: true,
      classification: String(classification).toUpperCase(),
      justification: effectivePolicy.insecureTlsJustification,
    };
  }
  return { rejectUnauthorized: true, insecure: false, classification: String(classification).toUpperCase(), justification: null };
}

module.exports = {
  ALLOWED_PROTOCOLS,
  DEV_ALLOWED_PROTOCOLS,
  BLOCKED_HOSTNAMES,
  BLOCKED_HOSTNAME_SUFFIXES,
  ENDPOINT_DENIAL_CODES,
  classificationRank,
  isProduction,
  parseIpv4,
  classifyIpv4,
  classifyIpv6,
  classifyAddress,
  isIpLiteral,
  normalizeEndpointPolicy,
  evaluateEndpoint,
  evaluateResolvedAddresses,
  evaluateRedirectChain,
  resolveTlsOptions,
};
