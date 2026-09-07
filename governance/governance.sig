{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "60d4b9b5202014a486b2ac46b7124f96464c83a2b3e6cf362076bb454d1a4c02",
  "chainRoot": "60d4b9b5202014a486b2ac46b7124f96464c83a2b3e6cf362076bb454d1a4c02",
  "gitCommit": "f4ce117ef89fa5ff951ffec56c5f9df241c3d957",
  "timestamp": "2026-09-07T12:47:34.911Z",
  "seal": "cc4add0d84ed89febce35e267ca2b48118139ae37e08e7a9380dd8975ec26797",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
