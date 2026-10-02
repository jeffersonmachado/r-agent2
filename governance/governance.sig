{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "519e139f004d6209b6daf01107f3cc9a86d75f0513993dc29c76980f76fd7a8e",
  "chainRoot": "519e139f004d6209b6daf01107f3cc9a86d75f0513993dc29c76980f76fd7a8e",
  "gitCommit": "d4e4f5ff5e69b47a75beffd5043df6789e08eceb",
  "timestamp": "2026-10-02T04:30:46.772Z",
  "seal": "8f861ec0be7b5aaf1490f2f13c1671e4b125f655f86d70473107d2518dd058bd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
