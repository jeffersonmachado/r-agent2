{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b7c38cb47cfcc3102135252f57e0d92da5757b2054fb666ce4b616a52f0bb6b1",
  "chainRoot": "b7c38cb47cfcc3102135252f57e0d92da5757b2054fb666ce4b616a52f0bb6b1",
  "gitCommit": "d1b322ffe6f388e80d01774b87305437baab84a3",
  "timestamp": "2026-09-06T16:26:37.554Z",
  "seal": "cd483e347ca452f5c85c9419dec69b25a9122c23982c2fa187bdbe2ab26ce760",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
