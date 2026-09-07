{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b46b2df7ecd05404d417b317421c531829408d395f399d7c7c6f677bc4b6e4c1",
  "chainRoot": "b46b2df7ecd05404d417b317421c531829408d395f399d7c7c6f677bc4b6e4c1",
  "gitCommit": "d8d0f13e032a70f67667ff4ea6a0e1a7c1328f53",
  "timestamp": "2026-09-07T09:11:14.967Z",
  "seal": "a004da613feb00d2be2f70872307f2253e6d019ca3225c486a5889860f56f80e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
