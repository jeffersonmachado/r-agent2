{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5b9e61f90df2ae2223aa07067ca1471aba56ad8023b7f7a04062ce237eb8e772",
  "chainRoot": "5b9e61f90df2ae2223aa07067ca1471aba56ad8023b7f7a04062ce237eb8e772",
  "gitCommit": "58b12b76",
  "timestamp": "2026-08-30T00:32:56.418Z",
  "seal": "3b24bb1fe375fad1ee9af227317557c7a776ea40edbbf59004d25932529559c8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
