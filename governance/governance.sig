{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "4c6659cdca50dd5da3ab09a27d638296eaae86269db3ec7ba0fd922219b51435",
  "chainRoot": "4c6659cdca50dd5da3ab09a27d638296eaae86269db3ec7ba0fd922219b51435",
  "gitCommit": "b929acc4002a1388eae2f4394245f8a700526002",
  "timestamp": "2026-09-12T16:50:54.601Z",
  "seal": "b55219d4add97cd3dfaca56f5a4e6f0f573adf2bfc95f0eb06bea25a96651d34",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
