{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d348d6a9001b6a4ff7724ba3b5c300acf3b68472f811fab23d5c3099137c66d1",
  "chainRoot": "d348d6a9001b6a4ff7724ba3b5c300acf3b68472f811fab23d5c3099137c66d1",
  "gitCommit": "256659639fc535fdd1a1eb96d79496044d5609f4",
  "timestamp": "2026-09-07T19:59:50.727Z",
  "seal": "d33a49ddc83880b6b6b8f6e43ffd22198a6a3a0c976b7a1b661394f9eaa97f72",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
