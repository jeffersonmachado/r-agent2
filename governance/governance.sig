{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "36130cf06576442902dc21ef9b3bc6ea2d7201105aaec20bc4ab9239b53f939a",
  "chainRoot": "36130cf06576442902dc21ef9b3bc6ea2d7201105aaec20bc4ab9239b53f939a",
  "gitCommit": "9a9b61a0abfae24f3b60610483a792bc15c032ed",
  "timestamp": "2026-09-13T14:35:04.979Z",
  "seal": "95c12e855b30a35cc51a3f576d0065451f171e016e26f1a4c499a5e6ba1e2988",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
