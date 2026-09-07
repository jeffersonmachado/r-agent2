{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "40606ebca57a7053d3f5d71fae0bcbe56f355c7956c6b0505dc0b0903169a230",
  "chainRoot": "40606ebca57a7053d3f5d71fae0bcbe56f355c7956c6b0505dc0b0903169a230",
  "gitCommit": "5acb9026a100987d311b169c87e974477464d486",
  "timestamp": "2026-09-07T11:36:26.279Z",
  "seal": "9446d44ef057d5e0cf28afd475ae7bf906e5340bd872bec2cca5e02356e06ffd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
