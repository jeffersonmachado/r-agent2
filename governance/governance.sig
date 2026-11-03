{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0719bbefa46b8d58ee078e4642fc00614ce456c814298dc0b52d638d25a10dcd",
  "chainRoot": "0719bbefa46b8d58ee078e4642fc00614ce456c814298dc0b52d638d25a10dcd",
  "gitCommit": "ba404a5b31a5c42448742d5d6ec8254524646365",
  "timestamp": "2026-11-03T20:11:05.285Z",
  "seal": "06fbb29f7cc769fe845e449a0b57119a7b744f036a0a91311b2d13062fe4f5c5",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
