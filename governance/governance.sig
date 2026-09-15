{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "bf3e5504e73bcb3b6bc714152af8bd64628c8e351b87540edb4bc97c88456435",
  "chainRoot": "bf3e5504e73bcb3b6bc714152af8bd64628c8e351b87540edb4bc97c88456435",
  "gitCommit": "e5af4a7371a66e94425b57f1c21a8a547d79d5d1",
  "timestamp": "2026-09-15T02:45:36.691Z",
  "seal": "3a153bf956e4ac21bff5d1da9c84e5ffd44e50f123c9e4966a2dc3aad2c3ecc0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
