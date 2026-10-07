{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9194cf52e4a5e9c575d1de4ba2712de77775bface250db367df106fa8d59b66b",
  "chainRoot": "9194cf52e4a5e9c575d1de4ba2712de77775bface250db367df106fa8d59b66b",
  "gitCommit": "52629bc149fec12e3577e6a6c53c7c18a2921b7a",
  "timestamp": "2026-10-07T06:16:44.431Z",
  "seal": "91ee846073a221776a244fa9b6d40519b99a4fa741b92813e0e98ab84c57d503",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
