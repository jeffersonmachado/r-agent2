{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d960b3c9ceec9bd6de6eb38f3b9714aa85e07523af35a6adbc6d7d82573c8106",
  "chainRoot": "d960b3c9ceec9bd6de6eb38f3b9714aa85e07523af35a6adbc6d7d82573c8106",
  "gitCommit": "74c8f666695c9bdd4f3cd46b86a0ed78507af1f6",
  "timestamp": "2026-09-02T17:53:56.011Z",
  "seal": "44edbe522b7bc03202a0d08fd0fac1cd94fa1d39bde2914a376753b71574d4e5",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
