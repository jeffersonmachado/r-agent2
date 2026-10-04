{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "40a0c9619a4f78c591abd082ca142a5d1b62668be6e668cf7ba8e0fbcac0f5f0",
  "chainRoot": "40a0c9619a4f78c591abd082ca142a5d1b62668be6e668cf7ba8e0fbcac0f5f0",
  "gitCommit": "4588ea54df863f1b37fede1100213e7ac744eb11",
  "timestamp": "2026-10-04T07:14:29.254Z",
  "seal": "92d628befc8487fd96f004135cafa783cde95b2cf3025b016571b443503e2660",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
