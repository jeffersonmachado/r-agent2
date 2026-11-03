{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f85232fa3ff218d2f7f7fd7d4e013a040743abaffd2c0fea27af87a68c9ab042",
  "chainRoot": "f85232fa3ff218d2f7f7fd7d4e013a040743abaffd2c0fea27af87a68c9ab042",
  "gitCommit": "fffa00997e277257c8d918f1a48a6effe23441b1",
  "timestamp": "2026-11-03T09:44:44.029Z",
  "seal": "5a590924caf2a1fde61bddb3b2de317af00d24695ba629831c825940e6cf51ee",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
