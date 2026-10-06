{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "8e53ba3cb60b745012414ec5e365dad5c51b45e00191713593cb3917d55ed908",
  "chainRoot": "8e53ba3cb60b745012414ec5e365dad5c51b45e00191713593cb3917d55ed908",
  "gitCommit": "8bd913567ff58f51709daf2dad4459a0f53518d7",
  "timestamp": "2026-10-06T21:21:45.534Z",
  "seal": "222a995fdcfe9960492dd580a8d5d5e43689e4a73e0a0b255b161641af6c5068",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
