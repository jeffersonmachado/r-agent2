{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9180e861d3d72d09f26da34cf12941104da43e97e670926ce47a2256a5323f49",
  "chainRoot": "9180e861d3d72d09f26da34cf12941104da43e97e670926ce47a2256a5323f49",
  "gitCommit": "4d2ff7538664fd103a8c6b56663f6267b629d94b",
  "timestamp": "2026-09-14T18:23:54.163Z",
  "seal": "90668caf714f96aa5690dcc8858638a4140ecc57c0a634ca40f27257f76aea9e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
