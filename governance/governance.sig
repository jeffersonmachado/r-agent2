{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "45a1905d8da34f1d8c0b4d920197eb8358224603d98e10f8cee5eb20c1b130ef",
  "chainRoot": "45a1905d8da34f1d8c0b4d920197eb8358224603d98e10f8cee5eb20c1b130ef",
  "gitCommit": "fb4915fb281fabf2ca52351e1559ff1e8c8a4c7e",
  "timestamp": "2026-09-14T23:49:43.598Z",
  "seal": "6be6b8a34a624a3d2f44d86e4c9e9ce27444b0916d33f87d1776713b69241db4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
