{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b22e410f46ef4498d684b69f6787dd8b9143c9a720f5d87ce176941b3786dfbd",
  "chainRoot": "b22e410f46ef4498d684b69f6787dd8b9143c9a720f5d87ce176941b3786dfbd",
  "gitCommit": "7610b589f51c21ae0080b664bbf6a25b3001f9a5",
  "timestamp": "2026-09-29T09:18:35.481Z",
  "seal": "a38ba67274c7a95611a9f658724758b7e9bf13d1ede2c7cd7f11e9b7a1ce6101",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
