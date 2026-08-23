{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ffc16c406a006cb4f346a1a80115bf0ef222ed48b2ff945bbd9133febd206e6e",
  "chainRoot": "ffc16c406a006cb4f346a1a80115bf0ef222ed48b2ff945bbd9133febd206e6e",
  "gitCommit": "f7d12203",
  "timestamp": "2026-08-23T16:20:25.161Z",
  "seal": "a2d56405d319d1033b055216b68b706b9b443bfae6b4b3a07e85e66913a11776",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
