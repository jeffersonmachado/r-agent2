{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fe5c9a7b69a4f35cb4235812d042f5ccd79b8087134496408081ebc74a93dfe4",
  "chainRoot": "fe5c9a7b69a4f35cb4235812d042f5ccd79b8087134496408081ebc74a93dfe4",
  "gitCommit": "4eba4a67e36c15f93b690a56de9b4b96d0a3eb38",
  "timestamp": "2026-09-27T00:56:16.935Z",
  "seal": "81d70408bd6e8cc9cfcb4e9b69b097129281fa339b5d0345c2b62b09c327d56f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
