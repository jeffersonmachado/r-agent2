{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fd0b3519be96f7090c0cca069a73305c944de5877b90495c6070a56a6f4fb8d1",
  "chainRoot": "fd0b3519be96f7090c0cca069a73305c944de5877b90495c6070a56a6f4fb8d1",
  "gitCommit": "6c4aabfd36e948210634bf4f87558afdf8160fab",
  "timestamp": "2026-09-14T15:49:34.003Z",
  "seal": "0f8ef51ff7a191e77abb60fab754021b338f68f1ecbe3e0cd1ee3642a781617f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
