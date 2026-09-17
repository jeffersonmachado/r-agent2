{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "6dbd556cc49eca9066aa7fbb18f7817fb5f07b10c4c1c989295db468b5f329eb",
  "chainRoot": "6dbd556cc49eca9066aa7fbb18f7817fb5f07b10c4c1c989295db468b5f329eb",
  "gitCommit": "02184f806a7519962b9c6b1d44096614103dce17",
  "timestamp": "2026-09-17T17:38:14.433Z",
  "seal": "400213db39126bb397cd654bcfbc004136aa9edf4b0339ff9433c90e8e4bba5b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
