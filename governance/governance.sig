{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ed9e32427bb54d18689298557860ec684e2043306b367e4d029fc47246ff362d",
  "chainRoot": "ed9e32427bb54d18689298557860ec684e2043306b367e4d029fc47246ff362d",
  "gitCommit": "b3df6b4a2d537955e87cd65343b59df64d447ca6",
  "timestamp": "2026-09-07T18:28:20.255Z",
  "seal": "03a0a5ed605df2b4276299818a77d9ccf41f68ca5e7375475da53c20b76700ee",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
