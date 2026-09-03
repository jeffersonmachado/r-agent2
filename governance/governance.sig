{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fe1cc40c23a253df7bb50647387274a86acea921f9b8c7eac724944473089b35",
  "chainRoot": "fe1cc40c23a253df7bb50647387274a86acea921f9b8c7eac724944473089b35",
  "gitCommit": "6ecbf65fb4ae8e71934bafee51bbeef748d4d390",
  "timestamp": "2026-09-03T20:24:37.252Z",
  "seal": "1b7e893be8404577944500a44ed3f557f96e1ba5a383584f81d5840089e5fb85",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
