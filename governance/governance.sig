{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c062781af0059cb4fd6079c8e7ec194b3886ea7a384e3bfbfce7f5bd8e1e3255",
  "chainRoot": "c062781af0059cb4fd6079c8e7ec194b3886ea7a384e3bfbfce7f5bd8e1e3255",
  "gitCommit": "2718d232178a7c17207220292d738df82d46b608",
  "timestamp": "2026-09-20T20:08:13.901Z",
  "seal": "2c6f9ab018d8859b08fb15cf67439d02d6cdb95bcee688112c7cfec5990865b2",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
