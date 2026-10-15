{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3d463e36b5b961bf35ba28bffa7c6b55c2854adaed78d8416f3441dd210dac3b",
  "chainRoot": "3d463e36b5b961bf35ba28bffa7c6b55c2854adaed78d8416f3441dd210dac3b",
  "gitCommit": "b1a48c4be969e22d8b990a063e56c8e531dd79dc",
  "timestamp": "2026-10-15T14:59:44.685Z",
  "seal": "ffddf5745f53c65627e1a68dd8cd5a327098928bb2254f7e265ab683ed37463a",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
