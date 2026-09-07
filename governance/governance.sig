{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0a8470264b1e277386db10d0c751ddaa4888c3435e9aa800eb4f32c3fa3edc3a",
  "chainRoot": "0a8470264b1e277386db10d0c751ddaa4888c3435e9aa800eb4f32c3fa3edc3a",
  "gitCommit": "cd865121c8c03a5343033f77328feae043aa5f5e",
  "timestamp": "2026-09-07T16:14:45.819Z",
  "seal": "f687d6128317ac7ea23a740e814bf1e8ff7079911af44c0111e3bb7b912e0308",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
