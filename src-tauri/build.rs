fn main() {
    println!("cargo::rustc-check-cfg=cfg(coverage)");
    tauri_build::build();

    // On Windows MSVC, Tauri's build generates a resource.lib containing a SxS manifest
    // activating comctl32 v6, plus VERSIONINFO and icon. Tauri links this to the bin
    // target via `rustc-link-arg-bins`.
    //
    // The integration test binary also needs the comctl32 v6 manifest because dependencies
    // (sqlx, keyring, tokio) cause the linker to pull in tao/wry symbols that reference
    // TaskDialogIndirect. Without the manifest, the test binary crashes with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139).
    //
    // We link the same resource.lib to the test target via `rustc-link-arg-tests`.
    // Command/bootstrap coverage lives under tests/integration/.
    #[cfg(windows)]
    {
        let out_dir = std::env::var("OUT_DIR").unwrap();
        let resource_lib = std::path::Path::new(&out_dir).join("resource.lib");
        if resource_lib.exists() {
            println!("cargo:rustc-link-arg-tests={}", resource_lib.display());
        }
    }
}
