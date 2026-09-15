{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2fee41f5b2883ae6f26613e2b3e123ed8b91315e1c9aa782f401410abe0230f7",
  "chainRoot": "2fee41f5b2883ae6f26613e2b3e123ed8b91315e1c9aa782f401410abe0230f7",
  "gitCommit": "a54732c8b256d3cef2854fe2994e460a32d39266",
  "timestamp": "2026-09-15T22:18:39.684Z",
  "seal": "65dd0fcf9b5c06ee9c9d9b4e4982cd94d681b1ba34dffc6be82e6e62aec92796",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
