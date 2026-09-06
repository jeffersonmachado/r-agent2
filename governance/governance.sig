{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "048c25f174ea14c0300a0045545601df7865f4da445100540caee0c15e6474d1",
  "chainRoot": "048c25f174ea14c0300a0045545601df7865f4da445100540caee0c15e6474d1",
  "gitCommit": "4e65a4e8f7aac04db636f25866ed909c5a07e168",
  "timestamp": "2026-09-06T18:07:44.228Z",
  "seal": "346bfd33e2b4692f8ab06c06cef204b25ac1a8909937c42b1d30716ded23b610",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
