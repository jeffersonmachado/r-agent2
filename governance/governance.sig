{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "42b806414c3e4355ab482cc2c4893a72731a20844ecb7dcef3dd4504db644df3",
  "chainRoot": "42b806414c3e4355ab482cc2c4893a72731a20844ecb7dcef3dd4504db644df3",
  "gitCommit": "d514f06d76c9c4497d2548a72e90ae35462417b9",
  "timestamp": "2026-09-09T09:20:41.012Z",
  "seal": "d7c099261c720188732859a2b48bf6fb5589dc669ae9aaf884920f5778bd7cdf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
