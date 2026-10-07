{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "67c5d626010add93bead5e3e107062344a1bb4d1dc1ea6ff780e0e8a285e99f5",
  "chainRoot": "67c5d626010add93bead5e3e107062344a1bb4d1dc1ea6ff780e0e8a285e99f5",
  "gitCommit": "9221266229601e6ad9b22c2f68c36da0854f54b9",
  "timestamp": "2026-10-07T04:40:51.721Z",
  "seal": "8c5b1177ddc3cac0ef5dcb2fe30936f9a4afd1ae0b2ef9239ce9ad18cc99c384",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
