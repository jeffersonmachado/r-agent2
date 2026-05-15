#!/usr/bin/env bash
# Central blocklist for release governance.
# These identifiers must not appear in final governance artifacts, manifests,
# signatures, or verifier results for a newly generated package.

BANNED_TIMESTAMPS=(
  "123004" "123425" "130148" "131448" "134204" "145516"
  "151613" "151841" "161016" "161850" "162718" "172955"
  "183350" "184107" "195145"
  "001703" "003119" "004342"
  "115045" "114508" "112508" "112142" "234326" "224210"
  "143633" "141247" "133639" "131737" "124500" "114953" "080658"
)

BANNED_HASHES=(
  "939a4e77d07c4fb9a74569fc5f567d9443a1766084f1c2fdfd9f8558275a1e59"
  "b19430a522467c4a5dfc1861873ec0dc2c3df60a5ee2bb4897f4b708d0bb9355"
  "7a675923"
  "fc1a8f9a"
)
