{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9832ba2d1bd8066106edcfac3f13ed0667dd7fdb4b0da3f337008e3450a87abd",
  "chainRoot": "9832ba2d1bd8066106edcfac3f13ed0667dd7fdb4b0da3f337008e3450a87abd",
  "gitCommit": "2c4378af007218b4dd6277a9d128733b84c62b23",
  "timestamp": "2026-10-04T12:39:58.230Z",
  "seal": "1e7b4ef0a908e756b984e919bb492c52c2541dc0761d3d6c3b2f9aefbaea843c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
