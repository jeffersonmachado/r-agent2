{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "76692486460d5748fc1e6808ba0744dd99a62fa17cf606020f74289366e2dea4",
  "chainRoot": "76692486460d5748fc1e6808ba0744dd99a62fa17cf606020f74289366e2dea4",
  "gitCommit": "ec8c5d3be6cb4c7444ee63459f802e0bbaef99c7",
  "timestamp": "2026-10-15T19:12:37.475Z",
  "seal": "e0a01c89629f99613a1b9ed1de19c3712dd7144c987b06e3267e3ec49e375706",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
