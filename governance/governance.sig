{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a569e862bc82345e0e0ca361c4280ab6a217b0897f06d2cd72b45b4cad49ebe4",
  "chainRoot": "a569e862bc82345e0e0ca361c4280ab6a217b0897f06d2cd72b45b4cad49ebe4",
  "gitCommit": "411897dab4ed7fe8055b99bd40f10ef9e1474a38",
  "timestamp": "2026-09-03T12:49:58.937Z",
  "seal": "149841768f1bbe24c313e74e3e4acb5786f557ceab9f2066dd757ad6db024064",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
