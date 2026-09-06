{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "75f1051f4d5daf7a0f58bd9884f8d81b16f89eca4bc7b798741c3992829ae116",
  "chainRoot": "75f1051f4d5daf7a0f58bd9884f8d81b16f89eca4bc7b798741c3992829ae116",
  "gitCommit": "8e28aa1c5d23fc1aea74f0d103f68c4294e4b1a7",
  "timestamp": "2026-09-06T06:41:15.232Z",
  "seal": "3c9b4b722d519d9966e69566556389cb9618835acf9228c60d4bf1d7b2bfa790",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
