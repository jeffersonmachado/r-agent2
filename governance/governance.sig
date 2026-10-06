{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "1e93ac221d09abf786825097dc5b36547dc57b56f1c9d95983552400dbbdb593",
  "chainRoot": "1e93ac221d09abf786825097dc5b36547dc57b56f1c9d95983552400dbbdb593",
  "gitCommit": "b31a5feb7f6c9a9f57f6c7b5ad135d922865382a",
  "timestamp": "2026-10-06T11:14:19.144Z",
  "seal": "b2ec4fc2c23a93049dae717cd3587a95b38d4729d1267e9b14541237176e35cb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
