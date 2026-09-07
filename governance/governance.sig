{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "945d3a66cac2470762b1089853448ee63e3e95aa2e7d50281ec13bb2e1446465",
  "chainRoot": "945d3a66cac2470762b1089853448ee63e3e95aa2e7d50281ec13bb2e1446465",
  "gitCommit": "db74f34a6ebc5008a66470ef0812b3f8d1e6928a",
  "timestamp": "2026-09-07T02:25:57.628Z",
  "seal": "5829cba2b81ebe82959194ed6146f9c7e9ede6e47c403a1eed2529cd3c88d016",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
