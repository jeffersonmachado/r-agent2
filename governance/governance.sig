{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "498399c9ca581b09f02c925b44036d6d48b01408f39e71953356e8740d271f80",
  "chainRoot": "498399c9ca581b09f02c925b44036d6d48b01408f39e71953356e8740d271f80",
  "gitCommit": "2dca12a0bcf1fb1f2a61a3b0fc0d5d12c17824d4",
  "timestamp": "2026-09-15T03:11:33.400Z",
  "seal": "7e1c6462c81e5b9ffd6629eb6d83e3b6db8258f2c7f932ecb04e1e28d3b67318",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
