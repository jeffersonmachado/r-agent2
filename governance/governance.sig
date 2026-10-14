{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a339dbeac87765d9605e1d4304c5ca713e189e5789a5d4fee8674db83935fcc5",
  "chainRoot": "a339dbeac87765d9605e1d4304c5ca713e189e5789a5d4fee8674db83935fcc5",
  "gitCommit": "d7036f0aecb9bf2487b0424fef537f4af27037d0",
  "timestamp": "2026-10-14T00:53:24.138Z",
  "seal": "c54e4a39d9e429bf1b43060e342014b7e39ff9386f2d6fd99c6cd947a913d3bf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
