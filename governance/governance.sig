{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "59dbfb1038f5ed4f63efc4dac4c7f7f16ca5fd74d901b0fff3dd96fa59f4454c",
  "chainRoot": "59dbfb1038f5ed4f63efc4dac4c7f7f16ca5fd74d901b0fff3dd96fa59f4454c",
  "gitCommit": "7442713dbd545fc116e55df70772ce5de3800845",
  "timestamp": "2026-10-15T15:18:30.010Z",
  "seal": "4b4379d075245fe0ffd6a5305d9d33d8fee17ccc79935a7793ee57a6ed93b2a7",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
