{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "cca0b95299c29fc5c1dc029d30112de214fe7cbdb087cd5e9c39e37754182eb4",
  "chainRoot": "cca0b95299c29fc5c1dc029d30112de214fe7cbdb087cd5e9c39e37754182eb4",
  "gitCommit": "e87c2f6e0059b7bd5e5d099c25fe4887424e0a51",
  "timestamp": "2026-09-12T04:25:18.252Z",
  "seal": "7cab9b22e65271b7ae852d48c7c2ce10c5dd77c821fd1540b001e75a58891842",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
