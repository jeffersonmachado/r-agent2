{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a60915c1b823f1a6b242da423076eaf0951a9843fb036425627f727da22fbc57",
  "chainRoot": "a60915c1b823f1a6b242da423076eaf0951a9843fb036425627f727da22fbc57",
  "gitCommit": "ead2e3157484ef57560ccdd1a3767ab7f632ebfa",
  "timestamp": "2026-09-17T18:07:45.381Z",
  "seal": "e653448c9ad0a61d7f95a2f4b69d9715ac37ede1c65bbed6f8a386ffcd611b53",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
