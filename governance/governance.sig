{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "dbbf2210c0f12260f6964514ca1fafe8cf1d001178a9006476528c35f2c72b01",
  "chainRoot": "dbbf2210c0f12260f6964514ca1fafe8cf1d001178a9006476528c35f2c72b01",
  "gitCommit": "badf7194875eff6bf672a446be68bfe7733e0cf8",
  "timestamp": "2026-10-04T16:08:40.266Z",
  "seal": "2236231a26c3eb347485bd3d68546c0dd3222b25fd35853599c7e214fe70357f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
