{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7c2dbcd72ca29122f35497850686c2004440cf67cab4c8901b9f4cf7d3bfedb9",
  "chainRoot": "7c2dbcd72ca29122f35497850686c2004440cf67cab4c8901b9f4cf7d3bfedb9",
  "gitCommit": "1b019fe9106c9e470e95e4014e8c24d94ec05c5c",
  "timestamp": "2026-09-07T19:27:07.225Z",
  "seal": "e8d42a1e212de3844cffc02035fb788759f8da7c79023617a6e4927d30040a43",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
