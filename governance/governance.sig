{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ed767f02059a1b5ff7a06646b0dc941310c47d0961c6909fcd603245de2b9bbf",
  "chainRoot": "ed767f02059a1b5ff7a06646b0dc941310c47d0961c6909fcd603245de2b9bbf",
  "gitCommit": "7435d7cccdbda0c187321dd8a1019ab9cdc7e3e7",
  "timestamp": "2026-09-12T16:11:45.015Z",
  "seal": "60a0351237e5c915d52ec735c62d4f2d57c2c5d56a4eed9b714d3a2c34878c9f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
