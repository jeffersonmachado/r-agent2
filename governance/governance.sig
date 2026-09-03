{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2ab693465410323d450457513dfc88545e323f436ae96c0a69a5a7f8b5cc345a",
  "chainRoot": "2ab693465410323d450457513dfc88545e323f436ae96c0a69a5a7f8b5cc345a",
  "gitCommit": "b8ddf11dc0485dd9865f8297d339150d9851fc0c",
  "timestamp": "2026-09-03T18:51:31.727Z",
  "seal": "a945b459351636c9ec2b859a804392c60292dfb20c382538d1c3aac5f6856723",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
