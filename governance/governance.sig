{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a65a80937b2d58ae0778baeeb11f7418d847d1ee518fef556eb8aec8cc8240e1",
  "chainRoot": "a65a80937b2d58ae0778baeeb11f7418d847d1ee518fef556eb8aec8cc8240e1",
  "gitCommit": "4b0f5ef4fbbf4d9473692015fba1a32a429995d9",
  "timestamp": "2026-08-22T11:19:55.889Z",
  "seal": "cce698c042d2fbabb93563b2e20b7f4f4cefb3eab4ded3e3f1244824cbf91446",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
