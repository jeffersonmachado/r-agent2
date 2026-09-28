{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "11017822a437b2e770e900a69e59beab043fc1aa582fbed6a4f9fbf3824ae8b8",
  "chainRoot": "11017822a437b2e770e900a69e59beab043fc1aa582fbed6a4f9fbf3824ae8b8",
  "gitCommit": "ff0befcde859a45a52d452b73c6c89bd6b544643",
  "timestamp": "2026-09-28T08:25:25.868Z",
  "seal": "7161f52532f9af17284dd7d835f6753d896e1cee3e0358516ec44ec2af546a7a",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
