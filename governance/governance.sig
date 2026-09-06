{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5bded5d5544466d8a33117f20370d2a60a08139307d3ccec521018e0d6d5f0f3",
  "chainRoot": "5bded5d5544466d8a33117f20370d2a60a08139307d3ccec521018e0d6d5f0f3",
  "gitCommit": "1d44c787077270e3a6dc51583f6f9c14e6308222",
  "timestamp": "2026-09-06T14:28:39.888Z",
  "seal": "b0e4e62799bf0b341aacc5d88c684996140e942666a61e2780d1f747f52b33a0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
