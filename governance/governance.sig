{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f5e4526a451209efeabef1f54ff79fc151af726c7501c071310a09e4bb2f3edc",
  "chainRoot": "f5e4526a451209efeabef1f54ff79fc151af726c7501c071310a09e4bb2f3edc",
  "gitCommit": "7f9a897983e46c07a382f7fdf913cf7980970c4f",
  "timestamp": "2026-09-06T06:17:21.434Z",
  "seal": "772666174aaab3ff68e1f6561647313e57372deae81fdc544d679a172f2c5a51",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
