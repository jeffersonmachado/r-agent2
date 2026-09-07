{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e304a6c55ee378f2f5d49575cd2458e7c99be6a8c98b9196cc8745f011b8e506",
  "chainRoot": "e304a6c55ee378f2f5d49575cd2458e7c99be6a8c98b9196cc8745f011b8e506",
  "gitCommit": "d66b9b77da00cfa9015a9e57f74496c2158fb666",
  "timestamp": "2026-09-07T11:11:28.446Z",
  "seal": "6ddfd74beb16d192c10ea69e3d5f09853a392262e3f59b3010c33eb82a44a52c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
