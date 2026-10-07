{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "6bdedcfda795ce62f2e8634769da42bee6607f8a10e02abedc2d6927e8f93b8a",
  "chainRoot": "6bdedcfda795ce62f2e8634769da42bee6607f8a10e02abedc2d6927e8f93b8a",
  "gitCommit": "fb3df240c6a2e5c978b086422c8dbda47495e874",
  "timestamp": "2026-10-07T04:28:12.315Z",
  "seal": "ea04c1f44a07a0dcac84f1f0b89b92e5013cd94ac77f0c7d1e4eb4204289a7cc",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
