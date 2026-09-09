{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b0ba2532e7985e8ca53f03bc654e2130d9b06ae70f64f7a7b2196069158617bb",
  "chainRoot": "b0ba2532e7985e8ca53f03bc654e2130d9b06ae70f64f7a7b2196069158617bb",
  "gitCommit": "61ff228824a7aaebedd6d652b8fbde4faf6a8e9e",
  "timestamp": "2026-09-09T07:48:04.122Z",
  "seal": "f53a7478bda202494c6a3df627f5bac833569caa0e96a09f6b7b74100fc0335a",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
