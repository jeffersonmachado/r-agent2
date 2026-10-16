{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d22cf8fa6b8035c7f54dd2e27a82f3a0df6beae03fb9e75984bf88ed8a4056f9",
  "chainRoot": "d22cf8fa6b8035c7f54dd2e27a82f3a0df6beae03fb9e75984bf88ed8a4056f9",
  "gitCommit": "d9c469e677eee10fd998fefdf9f5a0d61c6d37a0",
  "timestamp": "2026-10-16T16:49:00.175Z",
  "seal": "24454fe2efc905dd9f8f4cfe0c2abb247d05638668d7c9dbcc17f8dcd7bef2bf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
