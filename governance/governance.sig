{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d3d9575161af5352eb98d277dd0318153c85986fb1f0a29d9e49d339e2d931c0",
  "chainRoot": "d3d9575161af5352eb98d277dd0318153c85986fb1f0a29d9e49d339e2d931c0",
  "gitCommit": "4bdbf660dae6c0f3d0142fb7632578d679531015",
  "timestamp": "2026-09-03T20:36:54.596Z",
  "seal": "7b699e25dd96cb9f83bc90ac88fff9b1b8a088ada920330b2a9a3198f74127e7",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
