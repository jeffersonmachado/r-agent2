{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0d7bb8b049c8f877a577dfdda6976800a922b28c28ebb748cee8999cf33b6e38",
  "chainRoot": "0d7bb8b049c8f877a577dfdda6976800a922b28c28ebb748cee8999cf33b6e38",
  "gitCommit": "a4d54699a461590a1918f38b3d9ed4ad89b233f3",
  "timestamp": "2026-09-01T12:07:16.642Z",
  "seal": "96aedd4716abaf457d54154f3f9e6e27097524e8150d4846ca0a24c842edfdcb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
