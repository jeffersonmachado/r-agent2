{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "53c50038f4fe9d03429e9036cf7fd3deb5ac7aa612d05afb0844faca1cebd374",
  "chainRoot": "53c50038f4fe9d03429e9036cf7fd3deb5ac7aa612d05afb0844faca1cebd374",
  "gitCommit": "d593531d90b2a629627bfbd233026769ed21b740",
  "timestamp": "2026-09-05T21:57:24.676Z",
  "seal": "0c32780f1607a35533dca96ae8e5014d2901ffd0d0883ef4482f5d66109388c6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
