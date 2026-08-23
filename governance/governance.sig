{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d79061f56c2a6e92b6b857fb51c0bb128888958e6f73d1d6920d25d849bee21f",
  "chainRoot": "d79061f56c2a6e92b6b857fb51c0bb128888958e6f73d1d6920d25d849bee21f",
  "gitCommit": "28b83776",
  "timestamp": "2026-08-23T03:35:15.753Z",
  "seal": "2587774c90ab36581d2c441dfb8b5a4b629e9ba292ffffba8b28ee1a68e9ddb9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
