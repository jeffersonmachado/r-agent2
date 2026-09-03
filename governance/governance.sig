{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3e84ec84ceb0732fe8aa5a6cc32af3aeda16ce577ea3d33631b71b644175dc8f",
  "chainRoot": "3e84ec84ceb0732fe8aa5a6cc32af3aeda16ce577ea3d33631b71b644175dc8f",
  "gitCommit": "78fb46bd0c10cdcbbc9b85ea38f33583a1658997",
  "timestamp": "2026-09-03T12:34:58.979Z",
  "seal": "194c1fdeb61b03c9411a574bdc1a446f0c3537c41c78bdd2f2d845597a0ec1d0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
