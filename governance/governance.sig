{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ede4b8922d392d42034fabe43e7922b71767306c00cb2f48ecf0f95deaca264f",
  "chainRoot": "ede4b8922d392d42034fabe43e7922b71767306c00cb2f48ecf0f95deaca264f",
  "gitCommit": "3c4da656309e0805d37f7dcaead8c17bbd0eb7c6",
  "timestamp": "2026-09-18T20:41:05.242Z",
  "seal": "b551adeefa706a703207a2e767d963a754e27f587242392de386434d1cf67f39",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
