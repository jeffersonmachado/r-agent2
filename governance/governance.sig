{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3953e98952212ecc21c7397f0a3c20667f7a4c149e3c8817e5417abfcbac9502",
  "chainRoot": "3953e98952212ecc21c7397f0a3c20667f7a4c149e3c8817e5417abfcbac9502",
  "gitCommit": "69c6414b5b2a042b1e6e7d4d1aa96fc0848d55fd",
  "timestamp": "2026-09-06T20:24:38.278Z",
  "seal": "769ed58fe573ea1e66d2cbc66f926752c4bccc5ed54d971479b523e195c0c4dd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
