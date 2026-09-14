{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c464e2e835fba9a6324a39d3816f714f4d947a6fd2cb343775b5252d3c5c017d",
  "chainRoot": "c464e2e835fba9a6324a39d3816f714f4d947a6fd2cb343775b5252d3c5c017d",
  "gitCommit": "59fe9a54b3fa77a722120129a0ddadd99fb20f7e",
  "timestamp": "2026-09-14T03:20:15.839Z",
  "seal": "64f2165025376008a903208f706fa6c4249666c93d2676b58f47caf04ae312e0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
