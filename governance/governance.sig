{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0eeacaa55d90ee703ed781d42223711551bb95d6986a650a9f7ba1a593ac26bf",
  "chainRoot": "0eeacaa55d90ee703ed781d42223711551bb95d6986a650a9f7ba1a593ac26bf",
  "gitCommit": "fbc5ac91359c42461fac3bfeaac683296efb6eb0",
  "timestamp": "2026-09-02T17:57:40.364Z",
  "seal": "e6ce37f6a6937b36d9882e8f487c1faf16852bfb4f87aa87423aedd225429224",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
