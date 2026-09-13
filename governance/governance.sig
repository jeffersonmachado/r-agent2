{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "80d637ee201ac66e62c9a6a22eb31043a81c18738c589bc57c6978b302d9d675",
  "chainRoot": "80d637ee201ac66e62c9a6a22eb31043a81c18738c589bc57c6978b302d9d675",
  "gitCommit": "c7524c219d7d20530a19a109164155fa97fad09f",
  "timestamp": "2026-09-13T17:38:18.194Z",
  "seal": "b66a0c7a008943b71ed5c17721e37645e3c5c7f90c767416e44ac8115f818215",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
