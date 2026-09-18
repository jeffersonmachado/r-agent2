{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "30212d2d944a68e3408619bee0e0ee98083fe7fa162359613e3de8eff3944492",
  "chainRoot": "30212d2d944a68e3408619bee0e0ee98083fe7fa162359613e3de8eff3944492",
  "gitCommit": "0939538ab8214073afc1e22c864bb3d4bfc678d7",
  "timestamp": "2026-09-18T11:51:05.291Z",
  "seal": "d30e795e2d8474169232d17e1c7d478a4fa88aed469dc9988c58507ac9d85e34",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
