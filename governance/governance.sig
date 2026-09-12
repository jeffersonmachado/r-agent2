{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9fc970ca7163e8c0f7a76af4fb8fd59f49a00919bb94f5402e4258dd89e57bac",
  "chainRoot": "9fc970ca7163e8c0f7a76af4fb8fd59f49a00919bb94f5402e4258dd89e57bac",
  "gitCommit": "5c6bf2c3501c3e528b4340f80a4b3d1396edd381",
  "timestamp": "2026-09-12T15:07:59.484Z",
  "seal": "9bb4484fe7624264e149c4df5f3813504df5706a48a650b3900878ceac139a3b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
