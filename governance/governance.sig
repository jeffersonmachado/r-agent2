{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5bd665bdf6d8514bf922cf85c6a7a89c57562a211ce13c0104663940d5dd0dc3",
  "chainRoot": "5bd665bdf6d8514bf922cf85c6a7a89c57562a211ce13c0104663940d5dd0dc3",
  "gitCommit": "f42fa6b14ace068c190af22512ace2bd9324caa2",
  "timestamp": "2026-09-07T16:18:42.499Z",
  "seal": "2d3f3de66ea8d4989900df7983a797d546de3483b01218990000164971cfe443",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
