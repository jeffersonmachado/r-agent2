{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "917880cf2b441b7bcb310c5cfdfdc1c8f02028087835c1427d6f1ae92626b24e",
  "chainRoot": "917880cf2b441b7bcb310c5cfdfdc1c8f02028087835c1427d6f1ae92626b24e",
  "gitCommit": "6b789a57faac43b15f60fa6c2bd0bac638536501",
  "timestamp": "2026-09-23T22:01:15.265Z",
  "seal": "802bda60fe39fcde1d5a7581d749a21502ecc11bcbadc92d8dd3b173921bab94",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
