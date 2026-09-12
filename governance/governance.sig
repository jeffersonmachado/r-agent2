{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "8ecee887729b5a93957ae727be92134fc0d8e375f42d69a226fc5e7d6c087f89",
  "chainRoot": "8ecee887729b5a93957ae727be92134fc0d8e375f42d69a226fc5e7d6c087f89",
  "gitCommit": "b090232f9217b1819842c1cce0bde81dc15a2bd7",
  "timestamp": "2026-09-12T01:32:51.879Z",
  "seal": "08ed770069c771f83c07684ce7ac77fb4de7d7291cc2607e27bf8d3870c34f17",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
