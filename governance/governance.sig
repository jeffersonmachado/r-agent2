{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3894b7ca231b4d489980691a136febb0ab89fab73925ea6652e5bcf1863f1a99",
  "chainRoot": "3894b7ca231b4d489980691a136febb0ab89fab73925ea6652e5bcf1863f1a99",
  "gitCommit": "fb6ab3c4cd4c6a58d7f3e15b35a493a48bd9ea13",
  "timestamp": "2026-09-05T21:16:26.541Z",
  "seal": "432974f8688e44fdfb9c518f0824197ee9ebf0a07575c31cd7c5cdcfccfa7757",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
