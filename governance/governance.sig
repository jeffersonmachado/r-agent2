{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b87d3a4350148b5b4ae98ac70a64bcfe005fe0deee0cf635ee2ff878ca0249b7",
  "chainRoot": "b87d3a4350148b5b4ae98ac70a64bcfe005fe0deee0cf635ee2ff878ca0249b7",
  "gitCommit": "a684ee554020caea102eb0800211c93ad984b260",
  "timestamp": "2026-09-07T21:35:54.678Z",
  "seal": "b647c2fdcce9b1702e43f1dc00fbf1c4b8a401ca9525dc3975e1d2e872f5194b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
