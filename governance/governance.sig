{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f343bd099afdd32e12a7a8ed2f54e9eb3a2306229b095c01330177fee4e1deec",
  "chainRoot": "f343bd099afdd32e12a7a8ed2f54e9eb3a2306229b095c01330177fee4e1deec",
  "gitCommit": "543586c6f74731c612813b458d90ce127ddbb116",
  "timestamp": "2026-09-07T02:57:34.131Z",
  "seal": "7389aad1c133980f8fd3a95cd592a693b3fb992e08656d580dc6eb8e67be5431",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
