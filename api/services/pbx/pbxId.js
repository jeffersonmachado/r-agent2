function safePbxIdPart(raw) {
  const s = String(raw || '').trim();
  // Asterisk IDs: keep it simple and deterministic
  return s
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'id';
}

function makePjsipId(tenantKey, rawId) {
  return `${tenantKey}__${rawId}`;
}

function makeScopedPjsipId(tenantKey, scope, rawId) {
  const s = safePbxIdPart(scope);
  const r = safePbxIdPart(rawId);
  // ps_* id is varchar(40) in our schema
  const base = `${tenantKey}__${s}__${r}`;
  return base.length <= 40 ? base : base.slice(0, 40);
}

function makeTrunkPjsipId(tenantKey, trunkName) {
  return makeScopedPjsipId(tenantKey, 'trunk', trunkName);
}

module.exports = {
  makePjsipId,
  makeScopedPjsipId,
  makeTrunkPjsipId,
  safePbxIdPart,
};

