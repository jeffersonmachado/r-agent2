{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "82738a308f8f34ccb3f6dc0952c31eb8f30dcf5d9f2342e72c0ee6dc7e218160",
  "chainRoot": "82738a308f8f34ccb3f6dc0952c31eb8f30dcf5d9f2342e72c0ee6dc7e218160",
  "gitCommit": "ed4cf94371bfe1e38415f41f52e30467a4d05c01",
  "timestamp": "2026-09-07T11:06:38.263Z",
  "seal": "3006e6b45ba311467ea91812c5b0c4ac779f90d6e037e2f367cf420f5229257d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
