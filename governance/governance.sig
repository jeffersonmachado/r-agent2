{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "eb5aef8a12e2fc522784b71948ebc9386f889742e73361278eb764329181e8f4",
  "chainRoot": "eb5aef8a12e2fc522784b71948ebc9386f889742e73361278eb764329181e8f4",
  "gitCommit": "6181dfba05d4f80afcf8a470c7327a5466b5e302",
  "timestamp": "2026-09-14T16:15:15.791Z",
  "seal": "3c49c0974f3d71d941732a436276eff691937b063047caa282c67afe9b242da9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
