{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "90d3b87430990a26695b5ab332a2009cd3c2f9c8300af844cad1492c0888aaaa",
  "chainRoot": "90d3b87430990a26695b5ab332a2009cd3c2f9c8300af844cad1492c0888aaaa",
  "gitCommit": "9f72eefc2c8fd923d8fb0b716581bc0c16a91fb7",
  "timestamp": "2026-09-13T21:11:46.032Z",
  "seal": "9c85163ac2f04cdf96649d0883729ca43e7b161921faee99c97660befdc2ea34",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
