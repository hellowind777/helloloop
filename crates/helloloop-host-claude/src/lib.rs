use helloloop_domain::HostKind;
use helloloop_runtime::HostDescriptor;

pub fn descriptor() -> HostDescriptor {
    HostDescriptor::new(
        HostKind::Claude,
        "Claude Code",
        vec!["claude".to_string()],
        true,
        true,
        true,
        "Host adapter bootstrap for Claude Code",
    )
}
