{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9c1479de7ff199a9b6b616704122238aa5f3f8755686c3f66b0f62787c76eb74",
  "chainRoot": "9c1479de7ff199a9b6b616704122238aa5f3f8755686c3f66b0f62787c76eb74",
  "gitCommit": "3858a1f908de0637293564e45974c8a01d5211e7",
  "timestamp": "2026-09-07T03:36:46.350Z",
  "seal": "e885f63b55e1f57dd1055cc11a10dd87c41444185b78629065f7a433a486bbc6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
