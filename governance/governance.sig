{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "00cb9e8196633cf9ed30c37b8fa065ed818a7a67fda3d48de8c5a2f449550e47",
  "chainRoot": "00cb9e8196633cf9ed30c37b8fa065ed818a7a67fda3d48de8c5a2f449550e47",
  "gitCommit": "05779ad761391a6171c34f239f31f9064ad526cc",
  "timestamp": "2026-11-04T18:01:32.093Z",
  "seal": "4d20c8504369e7f15560efeaad954953302df94b708676d977ed58156a313646",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
