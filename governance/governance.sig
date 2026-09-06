{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "4c6a274451a15ecc3e171319ab22992fd72adae96afda6f960f4f26c3cca6c1e",
  "chainRoot": "4c6a274451a15ecc3e171319ab22992fd72adae96afda6f960f4f26c3cca6c1e",
  "gitCommit": "f89fd6f816ef7f2ec119c3b9d26d4ef1d769c207",
  "timestamp": "2026-09-06T21:51:31.947Z",
  "seal": "bd67bdaf977cef14cfdaa7a20a5ebe9e47fa6f333b6745298c06670d5fdf76e2",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
