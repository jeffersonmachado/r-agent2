{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "244582241210b5b44032a707324e9b3430a9a1b963d27e7165970d7b88d15c78",
  "chainRoot": "244582241210b5b44032a707324e9b3430a9a1b963d27e7165970d7b88d15c78",
  "gitCommit": "dc8e97d4e6fb9f761297524603808da2d4def95d",
  "timestamp": "2026-09-06T08:51:53.498Z",
  "seal": "c723e54f14c73bf850333e5794d76fa20b9cdf4812c607896a06177fec2089c0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
