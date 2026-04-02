use helloloop_domain::HostKind;
use helloloop_runtime::HostDescriptor;

pub fn descriptor() -> HostDescriptor {
    HostDescriptor::new(
        HostKind::Codex,
        "Codex CLI",
        vec!["codex".to_string()],
        true,
        true,
        true,
        "Host adapter bootstrap for Codex CLI",
    )
}
