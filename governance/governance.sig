{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "bb04cd1513c34e54f817692aa41ec9252c21c24b3acc68fb122d1b1b637dffe9",
  "chainRoot": "bb04cd1513c34e54f817692aa41ec9252c21c24b3acc68fb122d1b1b637dffe9",
  "gitCommit": "ff2f7db59039719740f8c4a0a434badfbde29616",
  "timestamp": "2026-10-14T14:48:21.395Z",
  "seal": "157f1b5d11cbba3d920603f6d04cae7f9536758a093b1dcd150aafb3358b2414",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
