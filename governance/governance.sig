{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0415c1e478f4d134276182a77e03945f9790b2e459f40c764b3f9c92b461256d",
  "chainRoot": "0415c1e478f4d134276182a77e03945f9790b2e459f40c764b3f9c92b461256d",
  "gitCommit": "ac61d46cca600add104f7d355eb37dc2ce653697",
  "timestamp": "2026-10-11T11:47:50.385Z",
  "seal": "c463c33d9062364aeaa79c59d47258b7abed9ff8fe12ed76d42539b191a42547",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
