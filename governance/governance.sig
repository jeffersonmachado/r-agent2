{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5a68a6857bbd447f5dfb2177566d3fdad8b759595331845efc8b8048288a618f",
  "chainRoot": "5a68a6857bbd447f5dfb2177566d3fdad8b759595331845efc8b8048288a618f",
  "gitCommit": "da0741f0d0f757b9766af901a78db7b45c502f45",
  "timestamp": "2026-09-20T17:16:34.557Z",
  "seal": "6d1a6c004fe1a7b96ac4a89ee2af6ceb6da72f609494020a0eb512d534f21cbf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
