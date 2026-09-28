{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7da5025ef607c6613058f5ab74d9fb55b943f8ca4605163f511e8f2bb7e8ab3a",
  "chainRoot": "7da5025ef607c6613058f5ab74d9fb55b943f8ca4605163f511e8f2bb7e8ab3a",
  "gitCommit": "69e400a8c3d78ad2025317765cbb7dfa73aa60d3",
  "timestamp": "2026-09-28T13:39:49.803Z",
  "seal": "63713b03fffe5f412868c37b71ee6025adf358c71ba18181ee97685d703981f4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
