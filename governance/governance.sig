{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9febaa8660b0d22834d6d08f36d355d5334bab376048451cb8b6e65c3c24dca5",
  "chainRoot": "9febaa8660b0d22834d6d08f36d355d5334bab376048451cb8b6e65c3c24dca5",
  "gitCommit": "707d279a1086c3d515056f01c32a4a82bbd713de",
  "timestamp": "2026-10-06T16:35:26.939Z",
  "seal": "d27bb865dbceb44ab563adc6502c3f6c48b91623c60502c96bac27a990ee0a72",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
