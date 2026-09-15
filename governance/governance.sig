{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ada9a64f3590931bd6c719981916a2595a35b74b26039b8a6822e800cd1ba724",
  "chainRoot": "ada9a64f3590931bd6c719981916a2595a35b74b26039b8a6822e800cd1ba724",
  "gitCommit": "29f0322dcf2d6f5ec542a506d1ebb12c8f2279fd",
  "timestamp": "2026-09-15T11:57:11.340Z",
  "seal": "f889a4bc7b5b066e95261636f4b12cf5a163fc39f099357ed7158eddcd3f9692",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
