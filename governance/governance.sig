{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "be49fdb128c538fb46fe786b4d260d8b00c4bf1a463c733d11c5617d0cca5f9b",
  "chainRoot": "be49fdb128c538fb46fe786b4d260d8b00c4bf1a463c733d11c5617d0cca5f9b",
  "gitCommit": "15440dd3ae88f781f9fde7c340c4ad33b2ea62e6",
  "timestamp": "2026-09-03T20:57:45.915Z",
  "seal": "495a035a663161ce7226247b70c5ec8fb9da8f40949ccbab9cbc6c33373d4011",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
