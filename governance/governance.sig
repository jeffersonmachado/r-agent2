{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "80ce93ccaeb5a0411aa1449b7128d497f7a1adc0975e1930fc947a46c83c0534",
  "chainRoot": "80ce93ccaeb5a0411aa1449b7128d497f7a1adc0975e1930fc947a46c83c0534",
  "gitCommit": "b8d10edb",
  "timestamp": "2026-08-22T05:10:35.864Z",
  "seal": "67f6dd44401cb445083991640c5daa16dcea656a1535a075fb6332b22cf2fffd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
