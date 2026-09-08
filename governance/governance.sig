{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9bf957e551c36d0c5b1edacfad10b8167dec9fdf04e4f1eace11f5f1739c9d2a",
  "chainRoot": "9bf957e551c36d0c5b1edacfad10b8167dec9fdf04e4f1eace11f5f1739c9d2a",
  "gitCommit": "1cbe7fe285200e65202f10f94266633bb5687576",
  "timestamp": "2026-09-08T21:21:42.030Z",
  "seal": "f5108db151c5396ffb5931cb81519bc44728a46003090f23c3f6d63f92e15946",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
