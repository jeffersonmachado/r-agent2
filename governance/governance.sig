{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3a4d3dd39c1dd6c50e2e7459898e0620c5ba661cd57f7b7f820793453ac97f41",
  "chainRoot": "3a4d3dd39c1dd6c50e2e7459898e0620c5ba661cd57f7b7f820793453ac97f41",
  "gitCommit": "38324f24",
  "timestamp": "2026-08-20T12:57:21.908Z",
  "seal": "642650fd822308cd437400aa1e7b8f859a047e6043202d99591530904fc7caa2",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
