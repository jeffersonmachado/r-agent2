{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a9b1d45e028d41b9bebcf67b37d4ea16eee060928c0aced29c6c3837de49167f",
  "chainRoot": "a9b1d45e028d41b9bebcf67b37d4ea16eee060928c0aced29c6c3837de49167f",
  "gitCommit": "a5aba816e77a830984f5bd675e08ee6850150577",
  "timestamp": "2026-09-13T17:26:45.617Z",
  "seal": "eb92c73b0326d7990b7bf9ef912c8e141b5a763cc17567fef6611168dbbfe47a",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
