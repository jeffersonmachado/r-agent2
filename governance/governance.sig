{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "201759af17e465c44df1f9c2d58d1aae6e9294adc1ebf416ca0e037b3d49a941",
  "chainRoot": "201759af17e465c44df1f9c2d58d1aae6e9294adc1ebf416ca0e037b3d49a941",
  "gitCommit": "8d01d595a3cb8e83dd09c07b6d5473d7475345ee",
  "timestamp": "2026-09-18T11:42:16.012Z",
  "seal": "01f99fa79dd216eb2ab0d0705713b96e1161269b596b4adfc7bb9ba50c8592b0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
