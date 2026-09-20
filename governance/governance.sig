{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "4be577a747683bfbadbc821885a7c3f20cf3bb7881c5aeb476d2357f2954fe05",
  "chainRoot": "4be577a747683bfbadbc821885a7c3f20cf3bb7881c5aeb476d2357f2954fe05",
  "gitCommit": "59e2d88dd1ddcccefb4ec68439327b306d741d98",
  "timestamp": "2026-09-20T21:52:24.974Z",
  "seal": "a60508f43f219ca3a28b8c8f632326c9e9964a57bf9032c361c4b9fd9e3d637c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
