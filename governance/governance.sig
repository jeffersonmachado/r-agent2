{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3054e0a3c6df64daa7aa0647d678bde9af21313390d9e27bba8d201fc93e100b",
  "chainRoot": "3054e0a3c6df64daa7aa0647d678bde9af21313390d9e27bba8d201fc93e100b",
  "gitCommit": "8c261d565fe3ea8379262eff0d6acbb762324d2a",
  "timestamp": "2026-09-06T05:51:54.865Z",
  "seal": "3c22a635be7bac795d1409b464e7c0433b3a655803e79e1dee16306fdb47e2af",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
