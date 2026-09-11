{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9694ab0409a054a8566bb383aecd0c5e3dd4fc51f3f333496e9048a6d09d03d5",
  "chainRoot": "9694ab0409a054a8566bb383aecd0c5e3dd4fc51f3f333496e9048a6d09d03d5",
  "gitCommit": "1aa4e1cc1b91bcf12f84cc063f0999ee30663e1e",
  "timestamp": "2026-09-11T12:20:43.206Z",
  "seal": "f4d0f66234740f18f811cf5f696e0c959eeb3cc5ccc23adcf870997f006013eb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
