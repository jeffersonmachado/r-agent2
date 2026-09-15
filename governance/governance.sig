{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "61fda3e134f46eb484bef39932b6221a82e5e291fe52c0abafb165c58aa146ac",
  "chainRoot": "61fda3e134f46eb484bef39932b6221a82e5e291fe52c0abafb165c58aa146ac",
  "gitCommit": "0367e8667a5c385c27539ad5a8974185ac2add02",
  "timestamp": "2026-09-15T23:46:44.654Z",
  "seal": "e5b3808fcd3a4abde44f49a20ef481374361c3ab0fbf804cc18a62c13dcc1468",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
