{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "dc06f22e84c3dd0292c23a22aef6e471dd37cd6aa70cdfa31035f696e84e2528",
  "chainRoot": "dc06f22e84c3dd0292c23a22aef6e471dd37cd6aa70cdfa31035f696e84e2528",
  "gitCommit": "1801601ec363d5e540cc4909470ad1cc1af10c0d",
  "timestamp": "2026-09-13T21:32:18.794Z",
  "seal": "39ea740574edf5a84ff1b403a900efdfbfbcbc67d25eef82ab7a8408d5a59db0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
