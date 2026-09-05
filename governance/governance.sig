{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e900f6e022e054ea1f6e24a7c562126c35f87d3fc3793aa09dd66c8fc2832714",
  "chainRoot": "e900f6e022e054ea1f6e24a7c562126c35f87d3fc3793aa09dd66c8fc2832714",
  "gitCommit": "804b3b907265bb54b31b9cff88220598851633db",
  "timestamp": "2026-09-05T21:51:58.467Z",
  "seal": "420882bce5f8e52e97cd230c5e055eb53fa1803bd8f2facc85deda80fff39aa1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
