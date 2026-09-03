{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fc9fe982155a65f4051c0eea69eb8a6d14a2410eae1c1ed8836314bb2f43ed76",
  "chainRoot": "fc9fe982155a65f4051c0eea69eb8a6d14a2410eae1c1ed8836314bb2f43ed76",
  "gitCommit": "6059697983b291477130832f8851ee322fd16f73",
  "timestamp": "2026-09-03T12:41:47.180Z",
  "seal": "b4643757c2afe24562a73e0dd28386142f0a91d8bee826855d3562ac7240001d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
