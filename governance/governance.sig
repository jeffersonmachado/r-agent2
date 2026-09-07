{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b2b4fff81c3e8339f89bfd0c248161e6938c73ad132117fe9cfd3a3e89c107e8",
  "chainRoot": "b2b4fff81c3e8339f89bfd0c248161e6938c73ad132117fe9cfd3a3e89c107e8",
  "gitCommit": "c695c0498251de716b90f0b63476b4f933f39d1e",
  "timestamp": "2026-09-07T19:23:16.698Z",
  "seal": "022b8cb694df890216d97c8def39051290cf64182f789d7722212e2a06c259be",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
