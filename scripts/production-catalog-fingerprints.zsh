#!/bin/zsh

# Reviewed on PostgreSQL 17.10 (Homebrew 17.10) and PostgreSQL 17.6
# (the pinned postgres:17.6 image matching the audited Supabase server). The
# catalog manifest includes server_version_num, so any other point release fails
# closed instead of silently inheriting either attestation.
readonly VSEE_CATALOG_PROTOTYPE="sha256:4bf140da8f16833fe281350626186538b3005bd2eb0475efc1ae16028393fe66"
readonly VSEE_CATALOG_0007="sha256:0594ed75ae7ac05be2f020bbcbf53f46542ab941a21b46a09c6a836418b3e1fd"
readonly VSEE_CATALOG_BRIDGED_0007="sha256:0be1555cb741812763f052583badc8897e695e3dcf53e922c6b0c3cf822b52d9"
readonly VSEE_CATALOG_0008="sha256:a0651d319b7fcdb2a0fc3bd4fabd78df76b02864765b8fdbea1f39aa049c1bbc"
readonly VSEE_CATALOG_BRIDGED_0008="sha256:a140ab0a826760a75b59b7c3abc2611ba9197c02e78191f2ab6e730d1ae0cd9a"
readonly VSEE_CATALOG_0009="sha256:57630cecd5f43fc9142dc458bbc0438dedcec488a6100e70e231d8f30b443a71"
readonly VSEE_CATALOG_BRIDGED_0009="sha256:e9eb1a277ed700fc7c3cf3f9b395d48f59d413c60bcb0e125335df593f20e775"
readonly VSEE_CATALOG_0011="sha256:03676c7222fb36e48e4ec71a0d303b94d6c9326b44a37428051327d340aac90a"
readonly VSEE_CATALOG_BRIDGED_0011="sha256:2cf65a26735016f7ea2ea44abe6d7176b1f0ac0b918a3691c704295d1e4e3d00"
readonly VSEE_CATALOG_0012="sha256:9e1adc42bf6cf354ede35ac76eca157971eb10f86cf5c646335718a9b65a37dc"
readonly VSEE_CATALOG_BRIDGED_0012="sha256:da4a83af8a627bd481434fba04aed8a60dd705a304a332a7a8c525f8e5f07461"
readonly VSEE_CATALOG_0013="sha256:672c66f710bfa25dd2e1973b832c2333135c1381dd5eaf83042c90232d5cf2ea"
readonly VSEE_CATALOG_BRIDGED_0013="sha256:498fc82c8f90bf8f258b2d82103621416f236f57648a0cdd738fa6f5cb711f2e"
readonly VSEE_CATALOG_0016="sha256:5b1b4e84c626def49687d01567ba66128aead57fbae0fbe47d47d79c9b1d5fb3"
readonly VSEE_CATALOG_BRIDGED_0016="sha256:6f8590a300262116c0d6a6f3980ae76277c73d6833bdb96b36d6f6d63ee3afc6"
readonly VSEE_CATALOG_0017="sha256:da11946a95fb8354b91a45eeb636987fd4359b827a5fe9fe77f46c8d1c278fac"
readonly VSEE_CATALOG_BRIDGED_0017="sha256:ba2db22017bffa15cc3d6aecaf602cde9c07e710c4f0e1f85854a193ae1abbaa"

readonly VSEE_CATALOG_PG176_PROTOTYPE="sha256:c5b9d1a84911bda621f472906b4f058a3e477d860cd732fc8893aba706ce5cad"
readonly VSEE_CATALOG_PG176_0007="sha256:0fa88731f4b1a914e59b7188640b091d5b7f37efd98b49e908c852eacd48bd57"
readonly VSEE_CATALOG_PG176_BRIDGED_0007="sha256:bf1e16882f7ed5df4758a8f4c0029f6801cafe59ba7042247ca2476b8d43d1e8"
readonly VSEE_CATALOG_PG176_0008="sha256:122b735ebd36705b0666996a049678b3b33ec30e8f07a44f585b3266fb433040"
readonly VSEE_CATALOG_PG176_BRIDGED_0008="sha256:1837e5b813404bfba94514595566804f276beca9a9f278a419a9ebb622366a4f"
readonly VSEE_CATALOG_PG176_0009="sha256:0f10ecd790dd989baf65187ea1eb7b76432bdce4f764b90bbfe22117b7c8623e"
readonly VSEE_CATALOG_PG176_BRIDGED_0009="sha256:45a80a85d4a8e13a5e087671b20304e10fed7daa33154d9c11e200b44c467aa2"
readonly VSEE_CATALOG_PG176_0011="sha256:6307fc89a4424350bb7c40723b80ad81c3575b03418891b3997556836bb036f8"
readonly VSEE_CATALOG_PG176_BRIDGED_0011="sha256:c97e6bd277663f673cf06684b19cb80a4af6aeee0d95ab2da02e56421813f47b"
readonly VSEE_CATALOG_PG176_0012="sha256:d7ab1d89226e5fa8c4687645a8f9dc37931194c16cb761401bcd0fcc5b3899da"
readonly VSEE_CATALOG_PG176_BRIDGED_0012="sha256:aa0e56a771c9c0f79433f81224304a63deb41c146ee5d14b705af299a64a8239"
readonly VSEE_CATALOG_PG176_0013="sha256:7ac336feacfa5da9854d4cee68d693066c221d61b51c9d6ae28489d5b1c01379"
readonly VSEE_CATALOG_PG176_BRIDGED_0013="sha256:6e6adbe48360d0a9e0355e074e45e21a4bd9fbc29213c97c17dc043137d391c0"
readonly VSEE_CATALOG_PG176_0016="sha256:b231fde6221df13ee83fb37420fe1eddcb17968beb26704e3fc396190dd49e0f"
readonly VSEE_CATALOG_PG176_BRIDGED_0016="sha256:f2e62c340f5ed31e4b8b9edfa803df38436a92d3056f2a18caacf351b6bd1131"
readonly VSEE_CATALOG_PG176_0017="sha256:0ac11a1f4a19814ad9f81841621956135a908dd604a02843dc18c2a6ac2802b0"
readonly VSEE_CATALOG_PG176_BRIDGED_0017="sha256:5501e1b4389f64af9d7d2a44a40b54abc6c9e50ec9263030e0a7413aeb488ba6"

vsee_catalog_variant() {
  case "$1" in
    "$VSEE_CATALOG_PROTOTYPE"|"$VSEE_CATALOG_PG176_PROTOTYPE") print -- "prototype" ;;
    "$VSEE_CATALOG_0007"|"$VSEE_CATALOG_PG176_0007") print -- "0007" ;;
    "$VSEE_CATALOG_BRIDGED_0007"|"$VSEE_CATALOG_PG176_BRIDGED_0007") print -- "bridged-0007" ;;
    "$VSEE_CATALOG_0008"|"$VSEE_CATALOG_PG176_0008") print -- "0008" ;;
    "$VSEE_CATALOG_BRIDGED_0008"|"$VSEE_CATALOG_PG176_BRIDGED_0008") print -- "bridged-0008" ;;
    "$VSEE_CATALOG_0009"|"$VSEE_CATALOG_PG176_0009") print -- "0009-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0009"|"$VSEE_CATALOG_PG176_BRIDGED_0009") print -- "0009-bridged-lineage" ;;
    "$VSEE_CATALOG_0011"|"$VSEE_CATALOG_PG176_0011") print -- "0011-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0011"|"$VSEE_CATALOG_PG176_BRIDGED_0011") print -- "0011-bridged-lineage" ;;
    "$VSEE_CATALOG_0012"|"$VSEE_CATALOG_PG176_0012") print -- "0012-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0012"|"$VSEE_CATALOG_PG176_BRIDGED_0012") print -- "0012-bridged-lineage" ;;
    "$VSEE_CATALOG_0013"|"$VSEE_CATALOG_PG176_0013") print -- "0013-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0013"|"$VSEE_CATALOG_PG176_BRIDGED_0013") print -- "0013-bridged-lineage" ;;
    "$VSEE_CATALOG_0016"|"$VSEE_CATALOG_PG176_0016") print -- "0016-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0016"|"$VSEE_CATALOG_PG176_BRIDGED_0016") print -- "0016-bridged-lineage" ;;
    "$VSEE_CATALOG_0017"|"$VSEE_CATALOG_PG176_0017") print -- "0017-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0017"|"$VSEE_CATALOG_PG176_BRIDGED_0017") print -- "0017-bridged-lineage" ;;
    *) return 1 ;;
  esac
}

vsee_catalog_matches_stage() {
  local stage="$1"
  local fingerprint="$2"
  case "$stage" in
    prototype)
      [[ "$fingerprint" == "$VSEE_CATALOG_PROTOTYPE" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_PROTOTYPE" ]]
      ;;
    0007)
      [[ "$fingerprint" == "$VSEE_CATALOG_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0007" ]]
      ;;
    0008)
      [[ "$fingerprint" == "$VSEE_CATALOG_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0008" ]]
      ;;
    0009|0010)
      [[ "$fingerprint" == "$VSEE_CATALOG_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0009" ]]
      ;;
    0011)
      [[ "$fingerprint" == "$VSEE_CATALOG_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0011" ]]
      ;;
    0012)
      [[ "$fingerprint" == "$VSEE_CATALOG_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0012" ]]
      ;;
    0013|0014|0015)
      [[ "$fingerprint" == "$VSEE_CATALOG_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0013" ]]
      ;;
    0016)
      [[ "$fingerprint" == "$VSEE_CATALOG_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0016" ]]
      ;;
    0017)
      [[ "$fingerprint" == "$VSEE_CATALOG_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0017" ]]
      ;;
    *) return 1 ;;
  esac
}
