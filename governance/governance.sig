{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c240cdf6f24fc513073face004e4d7a4fdcdee8c1913ecfc9213fd0ad3b64e55",
  "chainRoot": "c240cdf6f24fc513073face004e4d7a4fdcdee8c1913ecfc9213fd0ad3b64e55",
  "gitCommit": "9b0691fd38b66f4df098167d64bbe18da973754d",
  "timestamp": "2026-09-02T12:44:20.618Z",
  "seal": "edb86de0271b6c14babf7b3b51422341e445d04493a42faf2f60a0a77356424c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
