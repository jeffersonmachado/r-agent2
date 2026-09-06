{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "4dae8e995fdfbc08be74bed85617aff64f5d66d12ebe2747c7c09888b1a2b04f",
  "chainRoot": "4dae8e995fdfbc08be74bed85617aff64f5d66d12ebe2747c7c09888b1a2b04f",
  "gitCommit": "aea8fdff8171226fad4aa50f21f9b34629030ee6",
  "timestamp": "2026-09-06T05:12:43.450Z",
  "seal": "1cbfd864a2adb9fff8a0af34d35df818c3d34d5fa93df6d956cd5d62f8f51bd1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
