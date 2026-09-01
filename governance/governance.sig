{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f4f2fa4c1929c12f4378451ddf6462a3584fbcc831d519c703054a544112126c",
  "chainRoot": "f4f2fa4c1929c12f4378451ddf6462a3584fbcc831d519c703054a544112126c",
  "gitCommit": "23fa5c3bdd4fe17926868ae36345dff9063ef866",
  "timestamp": "2026-09-01T23:36:46.566Z",
  "seal": "a5ad5c7437dbae000c0d08014e2edc0035acb557f82273a95a3c7096e3b5dc66",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
