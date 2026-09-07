{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "52ef4199622e650f0e1b858aabee8be9624774b93b72b142774e319f1d89afeb",
  "chainRoot": "52ef4199622e650f0e1b858aabee8be9624774b93b72b142774e319f1d89afeb",
  "gitCommit": "54d16a3abc489dd95ab95d6dc17d726f1c192084",
  "timestamp": "2026-09-07T19:56:23.473Z",
  "seal": "234b5dd9b6b8a86224e5fd8dbb45e5ad960d04d43185330337a683b9cf881ceb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
