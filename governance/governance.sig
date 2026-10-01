{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "43173fd906a662b0812f0eed8130ca0706af93b130c892eab57d076441b66e1c",
  "chainRoot": "43173fd906a662b0812f0eed8130ca0706af93b130c892eab57d076441b66e1c",
  "gitCommit": "d5eb2322576530c0f76e111d91d4e1bda1ce95c7",
  "timestamp": "2026-10-01T19:50:43.478Z",
  "seal": "bc870ad492df837f3f03471b7f6bcff0b6f5ff2bb0cab15944075a94756ea925",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
