{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7195409bac465bdd9c9a75dd8b40a15bd24b1d9e0f4a62d77ae1c7c30eff402f",
  "chainRoot": "7195409bac465bdd9c9a75dd8b40a15bd24b1d9e0f4a62d77ae1c7c30eff402f",
  "gitCommit": "9f3728ed05a5380a01d7229b66136bd7bc62dbb2",
  "timestamp": "2026-09-05T17:29:25.711Z",
  "seal": "a5d2d0589000e5e94ede1346bb624879701bbb7a978803a8879908c3957fe791",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
