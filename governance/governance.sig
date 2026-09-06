{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f73c7d84acbdc405b9bb0064a5825bc2c8f42843e0e2dea1ad24245e32268fb4",
  "chainRoot": "f73c7d84acbdc405b9bb0064a5825bc2c8f42843e0e2dea1ad24245e32268fb4",
  "gitCommit": "71290c6a0a5b643301ce5e4a6df1c28521096081",
  "timestamp": "2026-09-06T11:20:57.742Z",
  "seal": "3f3d708f661fbe1cf2e0ce2fe89371fd8df7181ce72215bbf7caaa99d7f430de",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
