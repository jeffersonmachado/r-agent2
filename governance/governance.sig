{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0d3f0b1e40e50703c0151b2b96806441b946105d724c03932e5a616b61f312c4",
  "chainRoot": "0d3f0b1e40e50703c0151b2b96806441b946105d724c03932e5a616b61f312c4",
  "gitCommit": "fc5d4cb35d71db2a817cc41a1c0cb4d20bc2efab",
  "timestamp": "2026-10-01T16:47:07.814Z",
  "seal": "101b830d4cabb8d2109ed5f2cf62f386dfe2aa8e76379ed408eaa51f318af350",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
