{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3b2ba840b1c94bcd111c5679e0e13f643016acf2f2963dd3f8facfac2dea42fe",
  "chainRoot": "3b2ba840b1c94bcd111c5679e0e13f643016acf2f2963dd3f8facfac2dea42fe",
  "gitCommit": "272ba60ac3a089a410557a79262ae5a136955ed2",
  "timestamp": "2026-09-06T11:25:15.067Z",
  "seal": "cf064e8b1c3616b34c3bae9abeec6b7c4d9eb3e005d9e0f97fb2b8b096472dbb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
