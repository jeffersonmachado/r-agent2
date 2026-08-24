{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e9e7ede86359ff62ee29126d4bb3162ff350990355aa676f06d3defa8862c307",
  "chainRoot": "e9e7ede86359ff62ee29126d4bb3162ff350990355aa676f06d3defa8862c307",
  "gitCommit": "c803a089",
  "timestamp": "2026-08-24T16:47:05.695Z",
  "seal": "5e2f5341a6991007cc442cc216056a30cbb430793413d65f5b1a93660eca501b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
