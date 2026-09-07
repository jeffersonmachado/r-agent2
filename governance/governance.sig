{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "45023dbb141499e7edb6988daccaa15b0d7ccca5aa0972f9ad2f3a24686f0909",
  "chainRoot": "45023dbb141499e7edb6988daccaa15b0d7ccca5aa0972f9ad2f3a24686f0909",
  "gitCommit": "a26b15bc586dba0bd7507fa210c25540428ef896",
  "timestamp": "2026-09-07T20:38:35.105Z",
  "seal": "c3236c81ef6a8c747eedb3a24c434b0c3f54047ed595f99f487125525141f4b4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
