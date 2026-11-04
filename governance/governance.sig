{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d06e8f5569976c264c7d8213e7b77ed2e119c7341ce9933b7ab2f2cf90239ec0",
  "chainRoot": "d06e8f5569976c264c7d8213e7b77ed2e119c7341ce9933b7ab2f2cf90239ec0",
  "gitCommit": "54e26edbff4ab553a8d0f0a7c7cb287ad4fd72a7",
  "timestamp": "2026-11-04T03:26:27.350Z",
  "seal": "8ae0c4e669c22b0ba463333747601169a9b8ea9912b3096c5716044ac181e84f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
