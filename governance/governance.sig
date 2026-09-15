{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d4b30717fbaf708a32dc04ce221146284e0f9ac636f2afca32e3433d67d9aeb0",
  "chainRoot": "d4b30717fbaf708a32dc04ce221146284e0f9ac636f2afca32e3433d67d9aeb0",
  "gitCommit": "96ac28503302b55f0f4239e7466813925f430ed8",
  "timestamp": "2026-09-15T23:35:53.284Z",
  "seal": "ce3360133b24b11c63c3df8343221e049570b4f4fb2290dc4a9d140498888516",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
