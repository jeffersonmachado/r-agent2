{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b9769d0c530be77182f203f11a4df67bbb7f2314ad3c6a0962a5d023504b74b6",
  "chainRoot": "b9769d0c530be77182f203f11a4df67bbb7f2314ad3c6a0962a5d023504b74b6",
  "gitCommit": "f5d543e0d9e4a6cd09c76d9d42bd350f18d23df8",
  "timestamp": "2026-09-08T11:58:09.999Z",
  "seal": "0a87308a8997a1e0091712d496fe53ec6ef4ccaa09ab110f5cb9ea4b92642888",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
