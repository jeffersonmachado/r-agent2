{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "441cf618279ea4f4b90a6c13276f40e2e8a0943d46dc918df1f44febec581849",
  "chainRoot": "441cf618279ea4f4b90a6c13276f40e2e8a0943d46dc918df1f44febec581849",
  "gitCommit": "a284d5f4a7e7cd7e918a0f0d1c9169eca1f1063f",
  "timestamp": "2026-09-20T18:07:28.357Z",
  "seal": "4593609d4c034544c213de74e02fe3c201cd923422b1cab5b35920d643149f79",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
