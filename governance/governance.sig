{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7391e87e7d614d290e8c478b0de6c5784fc3c5df673f504a826ba64422f19039",
  "chainRoot": "7391e87e7d614d290e8c478b0de6c5784fc3c5df673f504a826ba64422f19039",
  "gitCommit": "1eefb5150815b3bf4dc142b9721749eec9771f9a",
  "timestamp": "2026-09-12T16:19:42.132Z",
  "seal": "5a21af23c21052065f0025df3b714ad57e20b19c437e0dabd45042612e3d7bd3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
