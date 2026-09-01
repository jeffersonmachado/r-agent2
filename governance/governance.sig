{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7364450e1bfd57de5db43dcc55c744ef66851a7ae7d6240175ccfdd0ec29a149",
  "chainRoot": "7364450e1bfd57de5db43dcc55c744ef66851a7ae7d6240175ccfdd0ec29a149",
  "gitCommit": "93265ea2641c8fdc212cb3e3b88975bece5d52e6",
  "timestamp": "2026-09-01T11:54:20.318Z",
  "seal": "766e11945240105346ad24d3159c2959d33988ecfc723e925669bad8e9569891",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
