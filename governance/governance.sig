{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e83a5c7c2765f487cd2671fc4afb66e159aa127c2219ba24dc8da18620ef0164",
  "chainRoot": "e83a5c7c2765f487cd2671fc4afb66e159aa127c2219ba24dc8da18620ef0164",
  "gitCommit": "55ebf323",
  "timestamp": "2026-08-20T17:39:35.386Z",
  "seal": "c868903fa80c1bd71333f278fd221fe0deedcbd85355713eacdde2778a2b3cf6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
