{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "495127c8fdfd9103c6e4a89b8caac741b696c845b79832aae03d7781984dcb5d",
  "chainRoot": "495127c8fdfd9103c6e4a89b8caac741b696c845b79832aae03d7781984dcb5d",
  "gitCommit": "2609cb5d0ff5a67fb47c236522abcf9a3baf5961",
  "timestamp": "2026-09-03T20:15:08.833Z",
  "seal": "05d1e932750c3d4b4686438ecb33887fc3444fd7ba92f057cd15baab2bb38b41",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
