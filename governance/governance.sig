{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "99e1de118ee4f399b36a2fb0235e46bc509dad9e5ce385883476504739eb688f",
  "chainRoot": "99e1de118ee4f399b36a2fb0235e46bc509dad9e5ce385883476504739eb688f",
  "gitCommit": "8bfbb61bd92c1b871a5121f309dda6aad2cb6d9f",
  "timestamp": "2026-10-17T07:21:48.569Z",
  "seal": "286620e24199629c6bd91418427eb219061b651624fb8d473afbff1e08bfe062",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
