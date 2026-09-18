{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "4b0e9ff3132c13887b3fd32ba028a25091505aaf323aa420f5f67c5ba956ce07",
  "chainRoot": "4b0e9ff3132c13887b3fd32ba028a25091505aaf323aa420f5f67c5ba956ce07",
  "gitCommit": "0221382db00621f5fe108fe465d3273aeffcd94f",
  "timestamp": "2026-09-18T20:32:37.116Z",
  "seal": "d8af270ed2b7c35233ac7f0bdf49c9bea64d96937ab89a047160212a132f256c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
