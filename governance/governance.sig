{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a34353b41d4888aa4666722776b89621d5e4f5f5886ecf50f24ae2c7d7b94560",
  "chainRoot": "a34353b41d4888aa4666722776b89621d5e4f5f5886ecf50f24ae2c7d7b94560",
  "gitCommit": "791051be801c91c0e9984ed37f32cd4b2b7b1ff7",
  "timestamp": "2026-09-14T23:53:42.378Z",
  "seal": "59e3e76ec799456d95ab18d5a2366d7b32e3e8d355054999063c60ea28cef4b9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
