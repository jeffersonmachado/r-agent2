{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "eb01225637cd23c58b269c052fd92e373f4e440fdf5c2cb3c2e278cfcdaa9b1e",
  "chainRoot": "eb01225637cd23c58b269c052fd92e373f4e440fdf5c2cb3c2e278cfcdaa9b1e",
  "gitCommit": "cb38564682580304e63c29bee651ff00884b0cfc",
  "timestamp": "2026-09-15T02:41:35.987Z",
  "seal": "4a7def10fc887d304ac5687dbaf43bb01209297551200b398f1d41d5d6600348",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
