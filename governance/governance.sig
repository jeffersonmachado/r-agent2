{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "388403cf32c9cfe61b98bcba0c7eb707c55fe3e6a52016ff111a3bb29cddd616",
  "chainRoot": "388403cf32c9cfe61b98bcba0c7eb707c55fe3e6a52016ff111a3bb29cddd616",
  "gitCommit": "d0f43b84f521b1741aa2a1c9bfec6494864dce4d",
  "timestamp": "2026-09-12T15:54:15.894Z",
  "seal": "88ae20a179f47ac3ccefaf682a3179558b5d85b78a6baa7acc9c57bb83a5178f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
