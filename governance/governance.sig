{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "75ba9dcc5635f661e1dd5ad4592dc79a8b5935fec216068abf3b0ae3932abb80",
  "chainRoot": "75ba9dcc5635f661e1dd5ad4592dc79a8b5935fec216068abf3b0ae3932abb80",
  "gitCommit": "3166b8c9",
  "timestamp": "2026-09-24T01:12:13.647Z",
  "seal": "337c95cc62a2602f4e82ec15f4bfa9cb548847956e28cf2d75690da6050cf55d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
