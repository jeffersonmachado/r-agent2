{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2f0bf81e493113291d96363e1e047b32f425adc7ec4c250221900eb8765377bd",
  "chainRoot": "2f0bf81e493113291d96363e1e047b32f425adc7ec4c250221900eb8765377bd",
  "gitCommit": "117a6018a6f6ce7608b9c8c4fa07b6195b7f9c53",
  "timestamp": "2026-11-04T03:07:32.536Z",
  "seal": "78a02be742f20c544a80c9996b03ed8081d34ad5b88bc83bcb90ad2af6217520",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
