{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "1916166def63bf29a8b8a486a4c8713df9b057d37b76cd94819ad32a6cd3ad46",
  "chainRoot": "1916166def63bf29a8b8a486a4c8713df9b057d37b76cd94819ad32a6cd3ad46",
  "gitCommit": "4208114949ce4e251c6c7a8af1a02d6f92ed69a6",
  "timestamp": "2026-09-13T12:28:59.879Z",
  "seal": "a1122c0f8ca24d85dc737e3511ec3d587541177d81baa9aeb4c1c8d0f2ac1417",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
