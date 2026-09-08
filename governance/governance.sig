{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "6bc3caf022635eef4468ad6f073c91467bf837702995721b0fd3b982c7bb1335",
  "chainRoot": "6bc3caf022635eef4468ad6f073c91467bf837702995721b0fd3b982c7bb1335",
  "gitCommit": "617ffee799f21334a1c49a58a03e18772d0ad90a",
  "timestamp": "2026-09-08T22:48:56.111Z",
  "seal": "dd98e011bfa44c7ba0c7fc588d3d4d9d8210c0858e8800d37c2f9131128fd0d3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
