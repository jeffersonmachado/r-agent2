{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9998c6bad6b5fc5ab3fb52d154cfa7e2a3ea92629139f9a19b0ebccaa41c7dae",
  "chainRoot": "9998c6bad6b5fc5ab3fb52d154cfa7e2a3ea92629139f9a19b0ebccaa41c7dae",
  "gitCommit": "46304e7bcdb67ea1ba2da97b1e1a250768611fb8",
  "timestamp": "2026-09-11T12:25:53.407Z",
  "seal": "b52eea7212e15565ad28eaa570fd79e252a13fda532d1848b79506e43f092d4c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
