{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3f3d442e9af296d9eb3ce3759c423c54a9cdfc52ac424d7b7c568abf5501f609",
  "chainRoot": "3f3d442e9af296d9eb3ce3759c423c54a9cdfc52ac424d7b7c568abf5501f609",
  "gitCommit": "cf3c48c1f56f81e946306e88639e2beea30b2929",
  "timestamp": "2026-09-18T11:08:18.107Z",
  "seal": "6de9e89ae69b4368906e9f703350ee537474ab9c494a7da1de6f3a0ce82a89b1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
