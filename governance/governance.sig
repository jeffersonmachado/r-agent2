{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b1d388562d411b15a4e55e733d56665acb6569734b11ea7c3bfc5a95d75f5b17",
  "chainRoot": "b1d388562d411b15a4e55e733d56665acb6569734b11ea7c3bfc5a95d75f5b17",
  "gitCommit": "ba8d7a180d3eef04f1b99973b558b94a357025f2",
  "timestamp": "2026-09-06T19:01:44.212Z",
  "seal": "6688157b50d526fb3f9544725f47383b3a1aa887a0116bb215674e7db975d901",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
