{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ef26281d1fc5fd4eea36f80d6457898a7c09b12a0980ce44c708fe848ebea36b",
  "chainRoot": "ef26281d1fc5fd4eea36f80d6457898a7c09b12a0980ce44c708fe848ebea36b",
  "gitCommit": "34e8aad24d64cc952497a7ad320c9a39b14e86b3",
  "timestamp": "2026-09-15T22:55:13.484Z",
  "seal": "76ddca26b5beb1001a3999ef7bbd560fb29ef8a2f0adb0593f099b39d9c57c92",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
