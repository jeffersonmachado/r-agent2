{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7bb128d62e9676d091cc3e5c206301982b5c36c9da3a5303d3e7cbfdba4cc247",
  "chainRoot": "7bb128d62e9676d091cc3e5c206301982b5c36c9da3a5303d3e7cbfdba4cc247",
  "gitCommit": "8531455950f9c046f25381a8bf0a51d239301a13",
  "timestamp": "2026-09-14T04:01:14.537Z",
  "seal": "a3b16356daaacb13df5fa378095ab0b785a5b9c2503cac4ed9839ddf9a70595d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
