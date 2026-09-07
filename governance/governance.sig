{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "35f403064fb1a8bf982ced610c5dd606cefa5742fd31c03f052adb3f7c7623a8",
  "chainRoot": "35f403064fb1a8bf982ced610c5dd606cefa5742fd31c03f052adb3f7c7623a8",
  "gitCommit": "a15e6069b0c14aa3a021e68efd10587365d5abd4",
  "timestamp": "2026-09-07T17:10:29.029Z",
  "seal": "173457591640770b75c48ba20ae74b19c204a1d662fec67c00887f8a8fb2c384",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
