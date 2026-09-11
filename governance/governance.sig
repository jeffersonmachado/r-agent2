{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "cf3a052a5524c7482154eaaa585f821dbdeb456563666c4248033077b860d340",
  "chainRoot": "cf3a052a5524c7482154eaaa585f821dbdeb456563666c4248033077b860d340",
  "gitCommit": "cfcd9c6f7878dfeebdedbff216a70ec71ab940c6",
  "timestamp": "2026-09-11T09:23:50.045Z",
  "seal": "1037dcf89a362419806b9a4d2e4e981629f6babc18364df8c7264165b5ad7fc8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
