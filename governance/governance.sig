{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2ad9b8256a5667fd75f2b2cb992afe3b8c8db70ba70f0dc897e3463240ba4062",
  "chainRoot": "2ad9b8256a5667fd75f2b2cb992afe3b8c8db70ba70f0dc897e3463240ba4062",
  "gitCommit": "4032d3b0747b7b003653a164e56c53356a92b923",
  "timestamp": "2026-09-15T19:06:28.760Z",
  "seal": "11ff8c3918c127c4823cc57b89c7e33457a8847d93e6305d66f37945612fefb8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
