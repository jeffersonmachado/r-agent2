{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a7129e61f18a6d66852cd65d04e9484fd3ab8c82965240a0969c5ef235a5c5ce",
  "chainRoot": "a7129e61f18a6d66852cd65d04e9484fd3ab8c82965240a0969c5ef235a5c5ce",
  "gitCommit": "a1d80007b23356a3282967b7383f9cdcb88237bc",
  "timestamp": "2026-09-06T17:16:53.799Z",
  "seal": "862a6043d98e24013acdbe0e198fb655b85c7db2af5dc59e39a190ca1611ac9d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
