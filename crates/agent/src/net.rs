//! Local network helpers: addresses for the QR code and mDNS advertisement.

use std::net::IpAddr;

/// Private IPv4 addresses of this machine, most likely LAN adapters first.
pub fn local_addresses() -> Vec<String> {
    let Ok(ifaces) = local_ip_address::list_afinet_netifas() else { return vec![] };
    let virtual_hint = |name: &str| {
        let n = name.to_ascii_lowercase();
        ["vethernet", "wsl", "docker", "virtualbox", "vmware", "hyper-v", "vbox", "utun", "tailscale", "zerotier", "loopback", "bridge"]
            .iter()
            .any(|h| n.contains(h))
    };
    let mut primary = Vec::new();
    let mut secondary = Vec::new();
    for (name, ip) in ifaces {
        let IpAddr::V4(v4) = ip else { continue };
        if v4.is_loopback() || v4.is_link_local() || !v4.is_private() {
            continue;
        }
        let s = v4.to_string();
        if virtual_hint(&name) {
            secondary.push(s);
        } else {
            primary.push(s);
        }
    }
    primary.extend(secondary);
    primary.dedup();
    primary
}

#[cfg(feature = "mdns")]
pub struct Advertiser {
    daemon: mdns_sd::ServiceDaemon,
    fullname: String,
}

#[cfg(feature = "mdns")]
impl Advertiser {
    /// Advertises `_vanepoint._tcp` with the protocol version and key fingerprint (never secrets).
    pub fn start(instance: &str, port: u16, fingerprint: &str) -> Option<Advertiser> {
        let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| log::warn!("mDNS unavailable: {e}")).ok()?;
        let host = format!("vanepoint-{}.local.", &fingerprint[..8.min(fingerprint.len())]);
        let props = [("v", "1"), ("fp", fingerprint), ("cap", "ws")];
        let info = mdns_sd::ServiceInfo::new("_vanepoint._tcp.local.", instance, &host, "", port, &props[..])
            .map_err(|e| log::warn!("mDNS service info: {e}"))
            .ok()?
            .enable_addr_auto();
        let fullname = info.get_fullname().to_string();
        daemon.register(info).map_err(|e| log::warn!("mDNS register: {e}")).ok()?;
        Some(Advertiser { daemon, fullname })
    }
}

#[cfg(feature = "mdns")]
impl Drop for Advertiser {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}

#[cfg(not(feature = "mdns"))]
pub struct Advertiser;

#[cfg(not(feature = "mdns"))]
impl Advertiser {
    pub fn start(_instance: &str, _port: u16, _fingerprint: &str) -> Option<Advertiser> {
        None
    }
}
