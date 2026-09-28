{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "12a5923d146c3e3a7b0d9ad97c23a542ab284b76aa33564945edf464f6eff066",
  "chainRoot": "12a5923d146c3e3a7b0d9ad97c23a542ab284b76aa33564945edf464f6eff066",
  "gitCommit": "b601690e495a2badc451c16901d89b741bc86c78",
  "timestamp": "2026-09-28T07:00:11.530Z",
  "seal": "918b5729548684a05f271cbb0bec30df87e990af73dca2c48e23286e724585b3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
