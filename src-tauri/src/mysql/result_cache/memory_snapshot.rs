pub trait MemorySnapshot: Send + Sync {
    fn refresh(&mut self) {}
    fn available_bytes(&self) -> u64;
    fn total_bytes(&self) -> u64;
}

pub struct SysinfoMemorySnapshot {
    sys: sysinfo::System,
}

impl Default for SysinfoMemorySnapshot {
    fn default() -> Self {
        Self::new()
    }
}

impl SysinfoMemorySnapshot {
    pub fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        Self { sys }
    }

    pub fn refresh(&mut self) {
        self.sys.refresh_memory();
    }
}

impl MemorySnapshot for SysinfoMemorySnapshot {
    fn refresh(&mut self) {
        self.sys.refresh_memory();
    }

    fn available_bytes(&self) -> u64 {
        // sysinfo's available_memory() omits macOS inactive pages and spuriously triggers RAM-pressure eviction.
        if let Some(bytes) = platform_reclaimable_bytes() {
            return bytes;
        }

        let available = self.sys.available_memory();
        if available > 0 {
            return available;
        }
        self.sys
            .total_memory()
            .saturating_sub(self.sys.used_memory())
    }

    fn total_bytes(&self) -> u64 {
        self.sys.total_memory()
    }
}

#[cfg(target_os = "macos")]
pub(super) fn platform_reclaimable_bytes() -> Option<u64> {
    macos_reclaimable_bytes()
}

#[cfg(not(target_os = "macos"))]
pub(super) fn platform_reclaimable_bytes() -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
pub(super) fn macos_reclaimable_bytes() -> Option<u64> {
    use std::mem;

    // SAFETY: the Mach calls write only to a stack-owned, zero-initialized out-param with an explicitly sized count, and the return code is checked before the result is read.
    unsafe {
        let page_size = libc::vm_page_size as u64;
        if page_size == 0 {
            return None;
        }

        let host = mach2::mach_init::mach_host_self();

        let mut stats: libc::vm_statistics64 = mem::zeroed();
        let mut count = libc::HOST_VM_INFO64_COUNT;
        let ret = libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            &mut stats as *mut _ as *mut libc::integer_t,
            &mut count,
        );
        mach2::mach_port::mach_port_deallocate(mach2::traps::mach_task_self(), host);

        if ret != libc::KERN_SUCCESS {
            return None;
        }

        let reclaimable_pages =
            stats.free_count as u64 + stats.inactive_count as u64 + stats.speculative_count as u64;
        Some(reclaimable_pages.saturating_mul(page_size))
    }
}
