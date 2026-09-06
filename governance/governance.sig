{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2ba7f145cd59560e089f4f47e093d2e28e14f4b6c661b014445f7ff38fca9b41",
  "chainRoot": "2ba7f145cd59560e089f4f47e093d2e28e14f4b6c661b014445f7ff38fca9b41",
  "gitCommit": "80f51f5c662d495724411c073c9e192ef217ab6c",
  "timestamp": "2026-09-06T21:25:23.736Z",
  "seal": "2e2cb5e481fe9c46643610be0ea72eb0cb972dd4bc683a239e519a62ad918620",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
