{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f65da8c631ed2ae5b5e61472773a3be3185b521c37bfa46076893853da5425fa",
  "chainRoot": "f65da8c631ed2ae5b5e61472773a3be3185b521c37bfa46076893853da5425fa",
  "gitCommit": "0161088424fb5665125e00e47ba3db6634ac3545",
  "timestamp": "2026-09-15T11:33:47.293Z",
  "seal": "823455eb6eb96416d80b7c2a06086583e07028caaec5c7d428332cc9e4fc3de0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
