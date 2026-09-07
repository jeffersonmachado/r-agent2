{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "96b62f9834f47fb7a8bfc9d1b2a5bb5dfdec44db23cd6cfa657ea1f086a4a275",
  "chainRoot": "96b62f9834f47fb7a8bfc9d1b2a5bb5dfdec44db23cd6cfa657ea1f086a4a275",
  "gitCommit": "e422149b0fb4074d21b4d4eb5a17343cb984e9f3",
  "timestamp": "2026-09-07T15:45:14.019Z",
  "seal": "ba424229ce7c96046dee752bd5d7e5a5abdd9dbc5efeaf6d927960e64a04b0c9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
