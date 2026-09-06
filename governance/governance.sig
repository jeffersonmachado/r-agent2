{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a220a4f7fbce1bf651226b4ce6e7bfa49213b93da816f6566ee389cb9abcfdd8",
  "chainRoot": "a220a4f7fbce1bf651226b4ce6e7bfa49213b93da816f6566ee389cb9abcfdd8",
  "gitCommit": "f6a74255e143ea834f52e327eab8bdfd66e50a91",
  "timestamp": "2026-09-06T16:21:37.030Z",
  "seal": "f22b215eb6ebe9f50d2ffe0347e4815d7b15f5eb2ba45c0805d83d090a940fe8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
