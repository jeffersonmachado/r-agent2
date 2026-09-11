{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9255a01b7e4d9f8b84a33ca0c54b748e58cb77545d41e689409076366df1fdac",
  "chainRoot": "9255a01b7e4d9f8b84a33ca0c54b748e58cb77545d41e689409076366df1fdac",
  "gitCommit": "11b8ad0595295a91cb2e12036d37ec2430476862",
  "timestamp": "2026-09-11T17:21:32.886Z",
  "seal": "bb9921f95042a90dc4760a191feddf0742ff0f1b7a0993a17721b495c496904e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
