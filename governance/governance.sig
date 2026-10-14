{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d1f60719634de16f8890e16599b37119b696f22f3f5879c9b34eef98b22d5029",
  "chainRoot": "d1f60719634de16f8890e16599b37119b696f22f3f5879c9b34eef98b22d5029",
  "gitCommit": "64cb97987fd3dd670a0912ab44bc36bded4fe643",
  "timestamp": "2026-10-14T16:50:19.759Z",
  "seal": "4659862f2e17015689cac118a5302e187e2460320ad0baf622988fbac74cba1c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
