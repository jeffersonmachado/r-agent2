{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "327d0f2e4beead714c46eb5df741a4663c26c8f3dfd5945e12c6dfe67e552d8e",
  "chainRoot": "327d0f2e4beead714c46eb5df741a4663c26c8f3dfd5945e12c6dfe67e552d8e",
  "gitCommit": "c2e1416c317fa09fc98cf122e2d02df080e3fe7b",
  "timestamp": "2026-09-06T14:24:40.199Z",
  "seal": "f6333c0dfc8e9b6b0050c262e90c675b9cb42fc780f6a31d9a1c0535e58c8bc3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
