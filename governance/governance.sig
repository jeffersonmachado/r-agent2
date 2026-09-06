{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "176687198c0d17065c8562a3cdd9bea207a5fd82d74407f1f4689a65dc6775c0",
  "chainRoot": "176687198c0d17065c8562a3cdd9bea207a5fd82d74407f1f4689a65dc6775c0",
  "gitCommit": "297d658d43e3901c1d0187d72a6766878a004f10",
  "timestamp": "2026-09-06T21:29:23.134Z",
  "seal": "f92fdc5d1d824eb6e149cb7f244c001c26930087b6d5fe9323ea5d16a0b73ef4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
