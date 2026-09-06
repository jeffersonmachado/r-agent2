{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "585abcc7f0898595466918cd431f29acf0ad37799af3e0e7de28507e5053c9a6",
  "chainRoot": "585abcc7f0898595466918cd431f29acf0ad37799af3e0e7de28507e5053c9a6",
  "gitCommit": "999176d165441a8aae1e1cff9fef527a083c0cbe",
  "timestamp": "2026-09-06T06:13:06.092Z",
  "seal": "ac3221645a15f574f495d391a86216ef9f107cc5d55345492008481f6d2658fd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
