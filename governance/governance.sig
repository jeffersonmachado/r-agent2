{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5806f213a3f228c4006ae370d43214fa15a7dc48e481edf4b8f2cb9dfbd27b94",
  "chainRoot": "5806f213a3f228c4006ae370d43214fa15a7dc48e481edf4b8f2cb9dfbd27b94",
  "gitCommit": "370f3a25d7152bb8c2ce8bd8a0a714d128cdba73",
  "timestamp": "2026-09-12T15:16:45.075Z",
  "seal": "35f845482155ec3a7f7b0db8625fda6ece6dd942723b8adc0e754678d73f83cd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
