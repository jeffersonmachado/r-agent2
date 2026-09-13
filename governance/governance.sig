{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "119b8b155b64db0f73b2c48847ed52e8626719d13fce38b202e1de4b234c8245",
  "chainRoot": "119b8b155b64db0f73b2c48847ed52e8626719d13fce38b202e1de4b234c8245",
  "gitCommit": "89fe12a52c11dacebf8b093618e627615b02183d",
  "timestamp": "2026-09-13T12:51:14.967Z",
  "seal": "ef96ba4925afbbb222c8de9a03d7c1e656d3e430744955c1ce1eb4a2292c10c0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
