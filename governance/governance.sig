{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "cbc2f36950e18ebf214f0658acc4999a6baccbce2e7ed6bfd5e0bad2b7afa52f",
  "chainRoot": "cbc2f36950e18ebf214f0658acc4999a6baccbce2e7ed6bfd5e0bad2b7afa52f",
  "gitCommit": "db995b20fdbf1175eea329c1d83a7c61c3caba72",
  "timestamp": "2026-09-03T16:47:40.192Z",
  "seal": "01b25310824692d69f7b3e2be312ecaa52f7b0fe3d3416342d4bce1ad1d478cf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
