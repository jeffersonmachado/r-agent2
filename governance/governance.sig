{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f05ed75aaaadd338b75b2aa168c066fe4c3f8e63468482ce91628ae4d02137dc",
  "chainRoot": "f05ed75aaaadd338b75b2aa168c066fe4c3f8e63468482ce91628ae4d02137dc",
  "gitCommit": "097b0e4c4e85d4921f1ec59c5ab0798a7d9097bc",
  "timestamp": "2026-10-16T12:07:46.101Z",
  "seal": "a6d5669fa20aeaa72997cea437f8101975c509e11e214cfdb5ad6ff37efa0fa3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
