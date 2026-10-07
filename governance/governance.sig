{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "125d6b609ef82a6fd1ad61f7ddd5eb6242c1181bb56ddda09b1f49038ce20fed",
  "chainRoot": "125d6b609ef82a6fd1ad61f7ddd5eb6242c1181bb56ddda09b1f49038ce20fed",
  "gitCommit": "351c800d797501c5c4b921a4e562bc62a4c2ec0a",
  "timestamp": "2026-10-07T10:37:06.072Z",
  "seal": "d359d6754a63f11f536d24b643b97a36a9450a16587d2c270d8bd895422141ca",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
