'use strict';

const getManifest = require('../../db/models/ReleaseManifestRecord');

async function persistManifest(input) {
  if (!input?.runId || !input.sourceFingerprint || !input.status) throw new Error('release_manifest_incomplete: runId, sourceFingerprint e status são obrigatórios');
  return getManifest().create({ ...input, metadata: input.metadata || {} });
}

module.exports = { persistManifest };