{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ea7a29853932deb9c9db8452e8b0682b4d359b5093bf108c06f6938d3f9b65b3",
  "chainRoot": "ea7a29853932deb9c9db8452e8b0682b4d359b5093bf108c06f6938d3f9b65b3",
  "gitCommit": "96950a35e8c5574b5a41c55c60a87d89d2a51b00",
  "timestamp": "2026-09-06T05:08:46.598Z",
  "seal": "3ba8e6a5e416971d29b1c5fb074fef5ca8b0de77991f3ae8fb837e0d5661ada7",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
