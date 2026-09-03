{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0cee624100c2f8706b5c50c3010ff25602ce9d8381dd3f3bca3cc06ef073657d",
  "chainRoot": "0cee624100c2f8706b5c50c3010ff25602ce9d8381dd3f3bca3cc06ef073657d",
  "gitCommit": "ab47fa4c8f8889e057f43cea2260416a66eb2628",
  "timestamp": "2026-09-03T20:00:31.418Z",
  "seal": "8c296237b876b51ab23191d49e5ae7adeeb6e36224450d525a99c866d46a1602",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
