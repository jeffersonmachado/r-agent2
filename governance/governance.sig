{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d2de2b25e014633d2195ed2870f1506b9eb8bcf7ab1a2d069ebe9743cea3b2da",
  "chainRoot": "d2de2b25e014633d2195ed2870f1506b9eb8bcf7ab1a2d069ebe9743cea3b2da",
  "gitCommit": "f8f0fd4018ebd2c9a72100c79beb88f192c2cd93",
  "timestamp": "2026-09-07T02:20:53.264Z",
  "seal": "d29077ef6ffb94b57cd356bf517aa377ba8e2e479305833a8516da27d4e53daf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
