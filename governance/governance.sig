{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "78b7c148be42f74ed5b02ba9aacf118552ef98673acac95e6a48cfd7892ec7ab",
  "chainRoot": "78b7c148be42f74ed5b02ba9aacf118552ef98673acac95e6a48cfd7892ec7ab",
  "gitCommit": "3fd5e6f1f03c11cdef700e519495cff3e1a93a79",
  "timestamp": "2026-09-15T23:06:14.796Z",
  "seal": "b4bb1931ef13209b22e8ac823cfe9f4a81a2cb6803f27498fe877c1511c6e2ef",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
