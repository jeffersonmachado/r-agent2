{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "16a18b468b404a250a26a1b1d20c0f3f6f686b85d097a1843c4af6039513b679",
  "chainRoot": "16a18b468b404a250a26a1b1d20c0f3f6f686b85d097a1843c4af6039513b679",
  "gitCommit": "f985c61a91a4528091fb72db75a7d95767d3f817",
  "timestamp": "2026-08-22T06:07:11.733Z",
  "seal": "e5f7eea197f9450502688bff17a92a431511715bab90b3303d77fa0f76aa7d8f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
