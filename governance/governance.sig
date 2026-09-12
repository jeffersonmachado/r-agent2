{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "10f4da700a1be6ab47b4991d5c5ce5f38f3839c0830e2f386b50bd546ca8110d",
  "chainRoot": "10f4da700a1be6ab47b4991d5c5ce5f38f3839c0830e2f386b50bd546ca8110d",
  "gitCommit": "4a3f4453f6d5044c611247c42502750fbaa0c48f",
  "timestamp": "2026-09-12T09:49:38.826Z",
  "seal": "6529844f36be19958ef813fde37c544086dd591fd142746d39cae82d660ecdbb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
