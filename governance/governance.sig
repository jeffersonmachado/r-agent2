{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "4685406535ce5d73ea3999ccd7ccdfe864e46844c1ec3e853bf12b43af9559cb",
  "chainRoot": "4685406535ce5d73ea3999ccd7ccdfe864e46844c1ec3e853bf12b43af9559cb",
  "gitCommit": "758db40109666256a80b0eec881f4d2ffc493ac7",
  "timestamp": "2026-09-18T14:59:23.106Z",
  "seal": "c870a8cabc5d44f57ed81be2ff239cf00c7d1a5734e349aa4468259256ea812c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
