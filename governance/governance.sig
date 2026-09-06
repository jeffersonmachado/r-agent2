{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "1c94e2feb181b45e025a4dfc34561ec049f6e9a50b75adf5387374ff69ef14bb",
  "chainRoot": "1c94e2feb181b45e025a4dfc34561ec049f6e9a50b75adf5387374ff69ef14bb",
  "gitCommit": "9685b2f09c8b78e42a9fb4ed9cb21edb90a1bc78",
  "timestamp": "2026-09-06T15:32:59.301Z",
  "seal": "dba388dada74ee5e5964b89e51a821a48b425938d54630b0ab3383d36cba0834",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
