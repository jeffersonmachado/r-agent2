{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "92991210f9025fa78c3adb7638dc313509b876f2cfbb9878ed9bbd2f03815c4d",
  "chainRoot": "92991210f9025fa78c3adb7638dc313509b876f2cfbb9878ed9bbd2f03815c4d",
  "gitCommit": "184cd983aff5ad2f12cddf5819a1fd92721f7e1d",
  "timestamp": "2026-09-06T05:47:08.744Z",
  "seal": "a319c472c9d564aac67723d1fbfb05cf0547696bbda73bf06a90313268228589",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
