{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2924395d424affc66324220f34edf0e241a5cc86ae6e6ec39ed587b2423747d7",
  "chainRoot": "2924395d424affc66324220f34edf0e241a5cc86ae6e6ec39ed587b2423747d7",
  "gitCommit": "e2456ec989bf0e75cbbab83b91b86f18e46911d2",
  "timestamp": "2026-09-13T14:43:19.219Z",
  "seal": "e852ecedb49bd55ce7c2f1e61f3d72bf0bf9cf1a5674bce98ab5c330a0c9059d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
