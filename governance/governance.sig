{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "cfc1fdce9356feb6b317d48e004a6efb0db13187ed9878f4ea9a038dd5f16605",
  "chainRoot": "cfc1fdce9356feb6b317d48e004a6efb0db13187ed9878f4ea9a038dd5f16605",
  "gitCommit": "c2397868c9fd623036cd99573aca55a59d57f82c",
  "timestamp": "2026-09-01T16:00:58.328Z",
  "seal": "59efca2475d47c2d6539ced0e8269fe27de522b9bcd0bd6e7e3ea105c4e9edcf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
