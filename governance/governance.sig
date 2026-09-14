{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d2ad49cd2be7a49c551c0260d8dfdc548488ad411162df57ebcdae867a2dde0d",
  "chainRoot": "d2ad49cd2be7a49c551c0260d8dfdc548488ad411162df57ebcdae867a2dde0d",
  "gitCommit": "76864a4c8c7084a987f5d1d8b4acdeaf7a5be3be",
  "timestamp": "2026-09-14T03:54:46.065Z",
  "seal": "8f97bc65e9e01c79f7dd40e81f5487171acc58281b30f6b6b6b103443109fb4e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
