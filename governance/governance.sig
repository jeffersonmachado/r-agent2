{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5f484f89c97aaf1744f7f0f1186aad1cc7128a34e1a1f640c39b76fd2f6dc727",
  "chainRoot": "5f484f89c97aaf1744f7f0f1186aad1cc7128a34e1a1f640c39b76fd2f6dc727",
  "gitCommit": "ba85f0e8109534e4599e57a60b53064af1d78c9d",
  "timestamp": "2026-09-27T21:24:32.051Z",
  "seal": "68d1cd8c4368e20bb4d5337c06d39d867d754a23178f4c330d3672610e216c77",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
